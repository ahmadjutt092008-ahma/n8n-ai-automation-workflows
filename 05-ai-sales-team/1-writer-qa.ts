import { workflow, node, trigger, sticky, ifElse, splitInBatches, nextBatch, languageModel, outputParser, expr } from '@n8n/workflow-sdk';

const runNow = trigger({ type: 'n8n-nodes-base.manualTrigger', version: 1, config: { name: 'Run Now', position: [0, 200] }, output: [{}] });

const daily = trigger({
  type: 'n8n-nodes-base.scheduleTrigger',
  version: 1.4,
  config: {
    name: 'Weekdays 1:30 PM PKT',
    parameters: { rule: { interval: [{ field: 'cronExpression', expression: '0 30 13 * * 1-5' }] } },
    position: [0, 400]
  },
  output: [{}]
});

const getLeads = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Get Leads Ready to Email',
    parameters: {
      resource: 'row',
      operation: 'get',
      dataTableId: { __rl: true, mode: 'id', value: 'YOUR_DATA_TABLE_ID', cachedResultName: 'DEMO_agency_leads' },
      matchType: 'allConditions',
      filters: { conditions: [{ keyName: 'status', condition: 'eq', keyValue: 'Ready to email' }] },
      returnAll: false,
      limit: 10
    },
    position: [240, 300]
  },
  output: [{ id: 4, agency: 'Neighbour Estate & Letting Agents Croydon', website: 'https://www.theneighbour.co.uk/', email: 'hello@example-lettings.co.uk', address: '33 Lower Addiscombe Road, Croydon', services: 'Sales, Lettings, Property Management', opener: 'I noticed that Neighbour managed over 300 properties in 2024.', status: 'Ready to email' }]
});

const loop = splitInBatches({ version: 3, config: { name: 'One Lead at a Time', parameters: { batchSize: 1 }, position: [480, 300] } });

const sentCheck = node({
  type: 'n8n-nodes-base.gmail',
  version: 2.2,
  config: {
    name: 'Already Emailed? (Gmail Sent)',
    parameters: {
      resource: 'message',
      operation: 'getAll',
      returnAll: false,
      limit: 1,
      simple: true,
      filters: { q: expr('to:{{ $json.email }} in:sent'), readStatus: 'both' }
    },
    credentials: { gmailOAuth2: { id: 'YOUR_CREDENTIAL_ID', name: 'Gmail account' } },
    alwaysOutputData: true,
    position: [720, 300]
  },
  output: [{}]
});

const alreadyIf = ifElse({
  version: 2.2,
  config: {
    name: 'Contacted Before?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
        conditions: [{ leftValue: expr('{{ $json.id ?? "" }}'), operator: { type: 'string', operation: 'notEmpty', singleValue: true } }],
        combinator: 'and'
      }
    },
    position: [940, 300]
  }
});

const markContacted = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Mark Already Contacted',
    parameters: {
      resource: 'row',
      operation: 'update',
      dataTableId: { __rl: true, mode: 'id', value: 'YOUR_DATA_TABLE_ID', cachedResultName: 'DEMO_agency_leads' },
      matchType: 'allConditions',
      filters: { conditions: [{ keyName: 'id', condition: 'eq', keyValue: expr('{{ $("One Lead at a Time").item.json.id }}') }] },
      columns: {
        mappingMode: 'defineBelow',
        value: { status: 'Already contacted', qa_notes: 'Skipped: an email to this address is already in Sent.' },
        schema: [
          { id: 'status', displayName: 'status', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'qa_notes', displayName: 'qa_notes', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }
        ]
      }
    },
    position: [1180, 100]
  },
  output: [{ id: 4, status: 'Already contacted' }]
});

const writerModel = languageModel({
  type: '@n8n/n8n-nodes-langchain.lmChatGoogleGemini',
  version: 1.2,
  config: {
    name: 'Writer Model',
    parameters: { modelName: 'models/gemini-3-flash-preview', options: { temperature: 0.5, maxOutputTokens: 8192 } },
    credentials: { googlePalmApi: { id: 'YOUR_CREDENTIAL_ID', name: 'Google Gemini(PaLM) Api account 7' } },
    position: [1180, 640]
  }
});

const writerParser = outputParser({
  type: '@n8n/n8n-nodes-langchain.outputParserStructured',
  version: 1.3,
  config: {
    name: 'Email Fields',
    parameters: { schemaType: 'fromJson', jsonSchemaExample: '{ "subject": "Tenant repair messages at Neighbour", "body": "Hi Neighbour team,\\n\\n..." }' },
    position: [1340, 640]
  }
});

const writer = node({
  type: '@n8n/n8n-nodes-langchain.chainLlm',
  version: 1.9,
  config: {
    name: 'Writer Agent',
    parameters: {
      promptType: 'define',
      text: expr('You are the Writer agent in a small AI sales team. Write ONE short cold email in British English from Ahmad Hassan, a freelance WhatsApp & n8n automation developer, to a UK letting agency.\n\nFacts you may use (do not add any other facts about the agency):\nAgency: {{ $("One Lead at a Time").item.json.agency }}\nWebsite: {{ $("One Lead at a Time").item.json.website }}\nAddress: {{ $("One Lead at a Time").item.json.address }}\nServices: {{ $("One Lead at a Time").item.json.services }}\nResearch note: {{ $("One Lead at a Time").item.json.opener }}\n\nWhat Ahmad offers: a WhatsApp assistant for letting agents that sorts tenant repair requests as Urgent, Normal or Low and alerts the right contractor; replies to new renters within a minute and asks for budget, move-in date and number of tenants; puts everything on one board for the team. Gas or carbon monoxide reports always get the National Gas Emergency number and go straight to a person.\n\nRules:\n- 110 to 170 words. Plain text, no markdown. Greeting "Hi <short agency name> team,".\n- First line uses the research note naturally, starting "I saw on your website" or similar. Then one line on the problem (tenant repair messages and renter enquiries arriving by WhatsApp after hours).\n- The three offer points as lines starting with "- ", then the gas safety line.\n- Ask: "I have a 50-second demo on sample data. Would you like me to send it over?"\n- Then: "I\'m looking for one agency in your area to try it with at an introductory price. A 15-minute call would be enough to see if it fits."\n- Sign off exactly:\nBest regards,\nAhmad Hassan\nWhatsApp & n8n Automation\n- Final line exactly: If you\'d rather not hear from me again, just reply "no thanks" and I won\'t email again.\n- Never invent clients, results, statistics, prices or discounts. No exclamation marks. No words like free, guarantee, act now.\n- subject: 4 to 8 words, specific to the agency, no clickbait.'),
      hasOutputParser: true
    },
    subnodes: { model: writerModel, outputParser: writerParser },
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 3000,
    position: [1180, 440]
  },
  output: [{ output: { subject: 'Tenant repair messages at Neighbour', body: 'Hi Neighbour team,...' } }]
});

const qaModel = languageModel({
  type: '@n8n/n8n-nodes-langchain.lmChatGoogleGemini',
  version: 1.2,
  config: {
    name: 'QA Model',
    parameters: { modelName: 'models/gemini-3-flash-preview', options: { temperature: 0, maxOutputTokens: 8192 } },
    credentials: { googlePalmApi: { id: 'YOUR_CREDENTIAL_ID', name: 'Google Gemini(PaLM) Api account 7' } },
    position: [1420, 640]
  }
});

const qaParser = outputParser({
  type: '@n8n/n8n-nodes-langchain.outputParserStructured',
  version: 1.3,
  config: {
    name: 'QA Verdict',
    parameters: { schemaType: 'fromJson', jsonSchemaExample: '{ "pass": true, "issues": "", "subject": "Tenant repair messages at Neighbour", "body": "Hi Neighbour team,\\n\\n..." }' },
    position: [1580, 640]
  }
});

const qa = node({
  type: '@n8n/n8n-nodes-langchain.chainLlm',
  version: 1.9,
  config: {
    name: 'QA Agent',
    parameters: {
      promptType: 'define',
      text: expr('You are the QA agent in a small AI sales team. Check this cold email before a human sends it.\n\nAllowed facts about the agency (anything else about them is invented):\nAgency: {{ $("One Lead at a Time").item.json.agency }}\nServices: {{ $("One Lead at a Time").item.json.services }}\nResearch note: {{ $("One Lead at a Time").item.json.opener }}\n\nDraft subject: {{ $json.output.subject }}\nDraft body:\n{{ $json.output.body }}\n\nCheck:\n1. No facts about the agency beyond the allowed facts. No invented clients, results, statistics, prices or discounts.\n2. Greeting uses the right agency name.\n3. Between 100 and 190 words.\n4. Contains the opt-out line about replying "no thanks".\n5. Signed "Ahmad Hassan".\n6. No spammy words (free, guarantee, act now, limited time) and no exclamation marks.\n7. Polite, plain British English, no markdown.\n\nIf there are only small problems, fix them yourself and return the fixed subject and body with pass true, and list what you fixed in issues. If something cannot be fixed safely (for example the email depends on an invented fact), return pass false and explain in issues. Always return a full subject and body.'),
      hasOutputParser: true
    },
    subnodes: { model: qaModel, outputParser: qaParser },
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 3000,
    position: [1420, 440]
  },
  output: [{ output: { pass: true, issues: '', subject: 'Tenant repair messages at Neighbour', body: 'Hi Neighbour team,...' } }]
});

const passIf = ifElse({
  version: 2.2,
  config: {
    name: 'QA Passed?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
        conditions: [{ leftValue: expr('{{ $json.output.pass }}'), operator: { type: 'boolean', operation: 'true', singleValue: true } }],
        combinator: 'and'
      }
    },
    position: [1660, 440]
  }
});

const makeDraft = node({
  type: 'n8n-nodes-base.gmail',
  version: 2.2,
  config: {
    name: 'Create Gmail Draft',
    parameters: {
      resource: 'draft',
      operation: 'create',
      subject: expr('{{ $json.output.subject }}'),
      emailType: 'text',
      message: expr('{{ $json.output.body }}'),
      options: { sendTo: expr('{{ $("One Lead at a Time").item.json.email }}') }
    },
    credentials: { gmailOAuth2: { id: 'YOUR_CREDENTIAL_ID', name: 'Gmail account' } },
    position: [1900, 340]
  },
  output: [{ id: 'r123', message: { id: 'm1', threadId: 't1' } }]
});

const markDrafted = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Mark Drafted',
    parameters: {
      resource: 'row',
      operation: 'update',
      dataTableId: { __rl: true, mode: 'id', value: 'YOUR_DATA_TABLE_ID', cachedResultName: 'DEMO_agency_leads' },
      matchType: 'allConditions',
      filters: { conditions: [{ keyName: 'id', condition: 'eq', keyValue: expr('{{ $("One Lead at a Time").item.json.id }}') }] },
      columns: {
        mappingMode: 'defineBelow',
        value: {
          status: 'Drafted',
          subject: expr('{{ $("QA Agent").item.json.output.subject }}'),
          email_body: expr('{{ $("QA Agent").item.json.output.body }}'),
          qa_notes: expr('{{ $("QA Agent").item.json.output.issues || "Passed" }}'),
          drafted_at: expr('{{ $now.toISO() }}')
        },
        schema: [
          { id: 'status', displayName: 'status', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'subject', displayName: 'subject', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'email_body', displayName: 'email_body', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'qa_notes', displayName: 'qa_notes', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'drafted_at', displayName: 'drafted_at', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }
        ]
      }
    },
    position: [2140, 340]
  },
  output: [{ id: 4, status: 'Drafted' }]
});

const markReview = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Mark Needs Review',
    parameters: {
      resource: 'row',
      operation: 'update',
      dataTableId: { __rl: true, mode: 'id', value: 'YOUR_DATA_TABLE_ID', cachedResultName: 'DEMO_agency_leads' },
      matchType: 'allConditions',
      filters: { conditions: [{ keyName: 'id', condition: 'eq', keyValue: expr('{{ $("One Lead at a Time").item.json.id }}') }] },
      columns: {
        mappingMode: 'defineBelow',
        value: {
          status: 'Needs review',
          subject: expr('{{ $json.output.subject }}'),
          email_body: expr('{{ $json.output.body }}'),
          qa_notes: expr('{{ $json.output.issues }}')
        },
        schema: [
          { id: 'status', displayName: 'status', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'subject', displayName: 'subject', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'email_body', displayName: 'email_body', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'qa_notes', displayName: 'qa_notes', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }
        ]
      }
    },
    position: [1900, 540]
  },
  output: [{ id: 4, status: 'Needs review' }]
});

const report = node({
  type: 'n8n-nodes-base.gmail',
  version: 2.2,
  config: {
    name: 'Email Me the Summary',
    parameters: {
      resource: 'message',
      operation: 'send',
      sendTo: 'you@example.com',
      subject: expr('AI Sales Team: {{ $input.all().filter(i => i.json.status === "Drafted").length }} drafts ready to send'),
      emailType: 'html',
      message: expr('<p>Today\'s run checked {{ $input.all().length }} leads.</p><ul><li>Drafts ready in Gmail: <b>{{ $input.all().filter(i => i.json.status === "Drafted").length }}</b></li><li>Already contacted (skipped): {{ $input.all().filter(i => i.json.status === "Already contacted").length }}</li><li>Needs your review: {{ $input.all().filter(i => i.json.status === "Needs review").length }}</li></ul><p>Open Gmail → Drafts, read each one and press Send. Send between 1 pm and 6 pm Pakistan time.</p>'),
      options: { appendAttribution: false }
    },
    credentials: { gmailOAuth2: { id: 'YOUR_CREDENTIAL_ID', name: 'Gmail account' } },
    executeOnce: true,
    onError: 'continueRegularOutput',
    position: [720, 60]
  },
  output: [{ id: 'msg-1' }]
});

const note = sticky('## AI Sales Team · Writer + QA\nRuns on weekdays at 1:30 pm PKT (or Run Now).\n1. Takes up to 10 leads with status "Ready to email" from DEMO_agency_leads.\n2. Skips anyone already in Gmail Sent.\n3. Writer agent drafts a personal email, QA agent checks facts, length, tone and opt-out line.\n4. Passed emails become Gmail drafts. A human presses Send.\n5. Summary email to Ahmad.', [], { color: 4, position: [-40, -260], width: 560, height: 260 });

export default workflow('ai-sales-team-writer', 'AI Sales Team · Writer + QA (Drafts)')
  .add(runNow)
  .to(getLeads)
  .add(daily)
  .to(getLeads)
  .to(loop
    .onDone(report)
    .onEachBatch(sentCheck.to(alreadyIf
      .onTrue(markContacted.to(nextBatch(loop)))
      .onFalse(writer.to(qa.to(passIf
        .onTrue(makeDraft.to(markDrafted.to(nextBatch(loop))))
        .onFalse(markReview.to(nextBatch(loop)))))))))
  .add(note);
