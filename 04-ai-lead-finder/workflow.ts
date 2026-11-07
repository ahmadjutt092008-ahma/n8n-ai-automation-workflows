import { workflow, node, trigger, sticky, languageModel, outputParser, newCredential, expr } from '@n8n/workflow-sdk';

const leadForm = trigger({
  type: 'n8n-nodes-base.formTrigger',
  version: 2.6,
  config: {
    name: 'Agencies to Research',
    parameters: {
      formTitle: 'Agency Lead Finder (Demo)',
      formDescription: 'Paste agency names, one per line (max 10). The workflow finds each website, reads it and saves contact details plus a personalised opening line.',
      formFields: {
        values: [
          { fieldLabel: 'Agencies', fieldName: 'Agencies', fieldType: 'textarea', placeholder: 'Letting International\nGrey & Co Estate Agents', requiredField: true },
          { fieldLabel: 'Area', fieldName: 'Area', fieldType: 'text', placeholder: 'London', requiredField: false }
        ]
      },
      responseMode: 'lastNode',
      options: { buttonLabel: 'Find leads', path: 'agency-lead-finder', appendAttribution: false }
    },
    position: [0, 300]
  },
  output: [{ Agencies: 'Letting International\nGrey & Co Estate Agents', Area: 'London' }]
});

const agencyList = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Agency List',
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: {
        assignments: [
          { id: 'a1', name: 'agencies', value: expr('{{ ($json.Agencies || "").split("\\n").map(s => s.trim()).filter(Boolean).slice(0, 10) }}'), type: 'array' },
          { id: 'a2', name: 'area', value: expr('{{ ($json.Area || "").trim() }}'), type: 'string' }
        ]
      }
    },
    position: [220, 300]
  },
  output: [{ agencies: ['Letting International', 'Grey & Co Estate Agents'], area: 'London' }]
});

const splitAgencies = node({
  type: 'n8n-nodes-base.splitOut',
  version: 1.1,
  config: {
    name: 'One Agency per Item',
    parameters: { fieldToSplitOut: 'agencies', include: 'allOtherFields', options: { destinationFieldName: 'agency' } },
    position: [440, 300]
  },
  output: [{ agency: 'Letting International', area: 'London' }]
});

const findSite = node({
  type: '@mendable/n8n-nodes-firecrawl.firecrawl',
  version: 1,
  config: {
    name: 'Find Website (Firecrawl Search)',
    parameters: {
      resource: 'MapSearch',
      operation: 'search',
      query: expr('{{ $json.agency }} {{ $json.area }} estate letting agent official website contact'),
      limit: 1
    },
    credentials: { firecrawlApi: newCredential('Firecrawl account') },
    onError: 'continueRegularOutput',
    position: [660, 300]
  },
  output: [{ success: true, data: { web: [{ url: 'https://www.example-agency.co.uk/', title: 'Example Agency', description: 'Letting agents' }] } }]
});

const pickSite = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Pick Website',
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: {
        assignments: [
          { id: 'p1', name: 'agency', value: expr('{{ $("One Agency per Item").item.json.agency }}'), type: 'string' },
          { id: 'p2', name: 'website', value: expr('{{ $json.data?.web?.[0]?.url ?? $json.data?.[0]?.url ?? $json.web?.[0]?.url ?? "" }}'), type: 'string' }
        ]
      }
    },
    position: [880, 300]
  },
  output: [{ agency: 'Letting International', website: 'https://www.example-agency.co.uk/' }]
});

const readSite = node({
  type: '@mendable/n8n-nodes-firecrawl.firecrawl',
  version: 1,
  config: {
    name: 'Read Website (Firecrawl Scrape)',
    parameters: {
      resource: 'Scraping',
      operation: 'scrape',
      url: expr('{{ $json.website }}'),
      scrapeOptions: { options: { formats: { format: [{ type: 'markdown' }] }, onlyMainContent: false } }
    },
    credentials: { firecrawlApi: newCredential('Firecrawl account') },
    onError: 'continueRegularOutput',
    position: [1100, 300]
  },
  output: [{ success: true, data: { markdown: '# Example Agency\nLettings and property management in Ilford. Email info@example-agency.co.uk Tel 020 0000 0000' } }]
});

const geminiModel = languageModel({
  type: '@n8n/n8n-nodes-langchain.lmChatGoogleGemini',
  version: 1.2,
  config: {
    name: 'Gemini Model',
    parameters: { modelName: 'models/gemini-3-flash-preview', options: { temperature: 0.2, maxOutputTokens: 8192 } },
    credentials: { googlePalmApi: { id: 'YOUR_CREDENTIAL_ID', name: 'Google Gemini(PaLM) Api account 7' } },
    position: [1300, 520]
  }
});

const leadParser = outputParser({
  type: '@n8n/n8n-nodes-langchain.outputParserStructured',
  version: 1.3,
  config: {
    name: 'Lead Fields',
    parameters: {
      schemaType: 'fromJson',
      jsonSchemaExample: '{ "email": "info@example.co.uk", "phone": "020 0000 0000", "address": "1 High Road, Ilford IG1 1AA", "services": "Lettings, property management, sales", "does_lettings": true, "fit_score": 80, "opener": "I noticed you manage lettings across Ilford and Gants Hill.", "notes": "" }'
    },
    position: [1460, 520]
  }
});

const extractLead = node({
  type: '@n8n/n8n-nodes-langchain.chainLlm',
  version: 1.9,
  config: {
    name: 'AI Extract Contact Details',
    parameters: {
      promptType: 'define',
      text: expr('You are helping a freelancer research UK letting agencies before writing to them. Read the website text below.\n\nReturn:\n- email: a public business email shown on the page (prefer lettings@, info@, contact@). Copy it exactly. If none is shown, empty string. Never guess or construct an email.\n- phone: main phone number shown, else empty.\n- address: main office address shown, else empty.\n- services: short comma list of what they offer.\n- does_lettings: true if they offer lettings or property management.\n- fit_score: 0-100, how likely they would benefit from a WhatsApp assistant that sorts tenant repair requests and replies to new renters (more lettings and managed properties = higher). 0 if the page is not an estate or letting agency.\n- opener: one friendly sentence for a cold email that mentions something specific and true from their page. No flattery, no invented facts.\n- notes: anything unclear, else empty.\n\nAgency: {{ $("Pick Website").item.json.agency }}\nWebsite: {{ $("Pick Website").item.json.website }}\n\nWebsite text:\n{{ ($json.data?.markdown ?? $json.markdown ?? "").slice(0, 15000) || "(no text could be read)" }}'),
      hasOutputParser: true
    },
    subnodes: { model: geminiModel, outputParser: leadParser },
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 3000,
    onError: 'continueRegularOutput',
    position: [1320, 300]
  },
  output: [{ output: { email: 'info@example.co.uk', phone: '020 0000 0000', address: '1 High Road, Ilford', services: 'Lettings, sales', does_lettings: true, fit_score: 80, opener: 'I noticed you manage lettings across Ilford.', notes: '' } }]
});

const leadRow = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Build Lead Row',
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: {
        assignments: [
          { id: 'r1', name: 'agency', value: expr('{{ $("Pick Website").item.json.agency }}'), type: 'string' },
          { id: 'r2', name: 'website', value: expr('{{ $("Pick Website").item.json.website }}'), type: 'string' },
          { id: 'r3', name: 'email', value: expr('{{ $json.output?.email || "" }}'), type: 'string' },
          { id: 'r4', name: 'phone', value: expr('{{ $json.output?.phone || "" }}'), type: 'string' },
          { id: 'r5', name: 'address', value: expr('{{ $json.output?.address || "" }}'), type: 'string' },
          { id: 'r6', name: 'services', value: expr('{{ $json.output?.services || "" }}'), type: 'string' },
          { id: 'r7', name: 'does_lettings', value: expr('{{ $json.output?.does_lettings === true }}'), type: 'boolean' },
          { id: 'r8', name: 'fit_score', value: expr('{{ Number($json.output?.fit_score) || 0 }}'), type: 'number' },
          { id: 'r9', name: 'opener', value: expr('{{ $json.output?.opener || "" }}'), type: 'string' },
          { id: 'r10', name: 'status', value: expr('{{ !$("Pick Website").item.json.website ? "Website not found" : ($json.output?.email ? "Ready to email" : "No public email") }}'), type: 'string' },
          { id: 'r11', name: 'found_at', value: expr('{{ $now.toISO() }}'), type: 'string' }
        ]
      }
    },
    position: [1560, 300]
  },
  output: [{ agency: 'Letting International', website: 'https://www.example-agency.co.uk/', email: 'info@example.co.uk', phone: '020 0000 0000', address: '1 High Road', services: 'Lettings', does_lettings: true, fit_score: 80, opener: 'I noticed...', status: 'Ready to email', found_at: '2026-10-15T21:00:00+05:00' }]
});

const saveLead = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Save Lead',
    parameters: {
      resource: 'row',
      operation: 'insert',
      dataTableId: { __rl: true, mode: 'id', value: 'YOUR_DATA_TABLE_ID', cachedResultName: 'DEMO_agency_leads' },
      columns: {
        mappingMode: 'defineBelow',
        value: {
          agency: expr('{{ $json.agency }}'),
          website: expr('{{ $json.website }}'),
          email: expr('{{ $json.email }}'),
          phone: expr('{{ $json.phone }}'),
          address: expr('{{ $json.address }}'),
          services: expr('{{ $json.services }}'),
          does_lettings: expr('{{ $json.does_lettings }}'),
          fit_score: expr('{{ $json.fit_score }}'),
          opener: expr('{{ $json.opener }}'),
          status: expr('{{ $json.status }}'),
          found_at: expr('{{ $json.found_at }}')
        },
        schema: [
          { id: 'agency', displayName: 'agency', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'website', displayName: 'website', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'email', displayName: 'email', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'phone', displayName: 'phone', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'address', displayName: 'address', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'services', displayName: 'services', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'does_lettings', displayName: 'does_lettings', required: false, defaultMatch: false, display: true, type: 'boolean', canBeUsedToMatch: true },
          { id: 'fit_score', displayName: 'fit_score', required: false, defaultMatch: false, display: true, type: 'number', canBeUsedToMatch: true },
          { id: 'opener', displayName: 'opener', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'status', displayName: 'status', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'found_at', displayName: 'found_at', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }
        ]
      }
    },
    position: [1780, 300]
  },
  output: [{ id: 1 }]
});

const done = node({
  type: 'n8n-nodes-base.form',
  version: 2.5,
  config: {
    name: 'Show Summary',
    parameters: {
      operation: 'completion',
      respondWith: 'text',
      completionTitle: 'Leads saved',
      completionMessage: expr('{{ $input.all().length }} agencies researched. Results are in the DEMO_agency_leads table.')
    },
    executeOnce: true,
    position: [2000, 300]
  }
});

const note = sticky('## Agency Lead Finder\nForm with agency names → Firecrawl Search finds each website → Firecrawl Scrape reads it → Gemini pulls public email, phone, services, a fit score and a personalised opening line → saved to DEMO_agency_leads.\n\nEmails are only copied from the page, never guessed. Agencies without a public email are marked "No public email".', [], { color: 4, position: [-40, -100], width: 560, height: 240 });

export default workflow('agency-lead-finder', 'DEMO · Agency Lead Finder (Firecrawl + AI)')
  .add(leadForm)
  .to(agencyList)
  .to(splitAgencies)
  .to(findSite)
  .to(pickSite)
  .to(readSite)
  .to(extractLead)
  .to(leadRow)
  .to(saveLead)
  .to(done)
  .add(note);
