import { workflow, node, trigger, sticky, ifElse, languageModel, outputParser, expr } from '@n8n/workflow-sdk';

const inbound = trigger({
  type: 'n8n-nodes-base.webhook',
  version: 2.2,
  config: {
    name: 'Incoming Message',
    parameters: { httpMethod: 'POST', path: 'letting-autopilot', responseMode: 'responseNode' },
    position: [0, 300]
  },
  output: [{ body: { name: 'Daniel', contact: '+44 7700 900123', message: 'Water is coming through my bathroom ceiling, Flat 2, 14 Orford Road' } }]
});

const normalize = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Normalize Message',
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: {
        assignments: [
          { id: 'n1', name: 'contact_name', value: expr('{{ $json.body?.name ?? $json.name ?? "Unknown" }}'), type: 'string' },
          { id: 'n2', name: 'contact', value: expr('{{ $json.body?.contact ?? $json.contact ?? "" }}'), type: 'string' },
          { id: 'n3', name: 'message', value: expr('{{ ($json.body?.message ?? $json.message ?? "").toString().trim() }}'), type: 'string' }
        ]
      }
    },
    position: [220, 300]
  },
  output: [{ contact_name: 'Daniel', contact: '+44 7700 900123', message: 'Water is coming through my bathroom ceiling, Flat 2, 14 Orford Road' }]
});

const gasCheck = ifElse({
  version: 2.2,
  config: {
    name: 'Gas or CO Mentioned?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
        conditions: [{ leftValue: expr('{{ /\\b(gas leak|smell(s|ing)? (of )?gas|gas smell|carbon monoxide|co alarm|co detector)\\b/i.test($json.message) }}'), operator: { type: 'boolean', operation: 'true', singleValue: true } }],
        combinator: 'and'
      }
    },
    position: [440, 300]
  }
});

const emergency = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Emergency Reply',
    parameters: {
      mode: 'manual',
      includeOtherFields: true,
      assignments: {
        assignments: [
          { id: 'e1', name: 'type', value: 'repair', type: 'string' },
          { id: 'e2', name: 'priority', value: 'emergency', type: 'string' },
          { id: 'e3', name: 'lead_score', value: 0, type: 'number' },
          { id: 'e4', name: 'summary', value: expr('Possible gas or carbon monoxide issue: {{ $json.message }}'), type: 'string' },
          { id: 'e5', name: 'property', value: '', type: 'string' },
          { id: 'e6', name: 'next_step', value: 'Property manager to call tenant now', type: 'string' },
          { id: 'e7', name: 'reply', value: 'If you smell gas or your carbon monoxide alarm is sounding, leave the property now, do not use switches or flames, and call the National Gas Emergency Service on 0800 111 999. If anyone feels unwell, call 999. We have alerted our property manager, who will contact you as soon as possible.', type: 'string' },
          { id: 'e8', name: 'needs_human', value: true, type: 'boolean' }
        ]
      }
    },
    position: [700, 120]
  },
  output: [{ contact_name: 'Sam', contact: '+44 7700 900456', message: 'I can smell gas in the kitchen', type: 'repair', priority: 'emergency', lead_score: 0, summary: 'Possible gas or carbon monoxide issue', property: '', next_step: 'Property manager to call tenant now', reply: 'If you smell gas...', needs_human: true }]
});

const geminiModel = languageModel({
  type: '@n8n/n8n-nodes-langchain.lmChatGoogleGemini',
  version: 1.2,
  config: {
    name: 'Gemini Model',
    parameters: { modelName: 'models/gemini-3.8-flash', options: { temperature: 0.1, maxOutputTokens: 1024 } },
    credentials: { googlePalmApi: { id: 'YOUR_CREDENTIAL_ID', name: 'Google Gemini(PaLM) Api account 2' } },
    position: [660, 620]
  }
});

const triageParser = outputParser({
  type: '@n8n/n8n-nodes-langchain.outputParserStructured',
  version: 1.3,
  config: {
    name: 'Triage Fields',
    parameters: {
      schemaType: 'fromJson',
      jsonSchemaExample: '{ "type": "repair", "priority": "urgent", "lead_score": 0, "summary": "Leak through bathroom ceiling", "property": "Flat 2, 14 Orford Road", "next_step": "On-call plumber to call tenant", "reply": "Sorry to hear that. We have logged this as urgent and our on-call plumber will contact you shortly.", "needs_human": false, "reasoning": "Active water leak can damage the property" }'
    },
    position: [820, 620]
  }
});

const triage = node({
  type: '@n8n/n8n-nodes-langchain.chainLlm',
  version: 1.9,
  config: {
    name: 'AI Triage',
    parameters: {
      promptType: 'define',
      text: expr('You are the WhatsApp assistant of a UK letting agency. Read one incoming message and return JSON.\n\ntype:\n- "repair" = a current tenant reporting a problem in their home\n- "lead" = someone asking to rent or view a property\n- "other" = anything else (landlord question, complaint, rent query, spam)\n\npriority for repairs:\n- "urgent" = active water leak, flooding, no heating or hot water, no electricity, sewage or blocked only toilet, broken front door lock or window, anything unsafe\n- "normal" = broken appliance, damp or mould, minor leak under control\n- "low" = cosmetic or "no rush" items\nFor leads use "normal" and for other use "low".\n\nlead_score (leads only, else 0), add up: clear property or area +20, budget given +20, move-in date within 6 weeks +20, number of tenants given +10, employment or income mentioned +15, asks for a viewing +15.\n\nsummary: one line with the key facts. property: address or area if given, else "".\nnext_step: what the agency team should do next, one short line.\nreply: a short, friendly WhatsApp reply in British English to send to the person. For repairs, confirm it is logged and its priority, and ask for a photo if useful. For urgent repairs give one simple safety tip if relevant. For leads ask only for the details still missing (budget, move-in date, number of tenants, employment). Never invent prices, availability, appointment times or names of staff.\nneeds_human: true for complaints, legal threats, rent or deposit disputes, or anything you are unsure about.\nreasoning: one short line explaining the priority.\n\nSender name: {{ $json.contact_name }}\nMessage: {{ $json.message }}'),
      hasOutputParser: true
    },
    subnodes: { model: geminiModel, outputParser: triageParser },
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 3000,
    position: [700, 420]
  },
  output: [{ output: { type: 'repair', priority: 'urgent', lead_score: 0, summary: 'Leak through bathroom ceiling', property: 'Flat 2, 14 Orford Road', next_step: 'On-call plumber to call tenant', reply: 'Sorry to hear that...', needs_human: false, reasoning: 'Active leak' } }]
});

const mapTriage = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Map AI Result',
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: {
        assignments: [
          { id: 'm1', name: 'contact_name', value: expr('{{ $("Normalize Message").item.json.contact_name }}'), type: 'string' },
          { id: 'm2', name: 'contact', value: expr('{{ $("Normalize Message").item.json.contact }}'), type: 'string' },
          { id: 'm3', name: 'message', value: expr('{{ $("Normalize Message").item.json.message }}'), type: 'string' },
          { id: 'm4', name: 'type', value: expr('{{ ["repair","lead","other"].includes($json.output.type) ? $json.output.type : "other" }}'), type: 'string' },
          { id: 'm5', name: 'priority', value: expr('{{ ["urgent","normal","low"].includes($json.output.priority) ? $json.output.priority : "normal" }}'), type: 'string' },
          { id: 'm6', name: 'lead_score', value: expr('{{ Math.max(0, Math.min(100, Number($json.output.lead_score) || 0)) }}'), type: 'number' },
          { id: 'm7', name: 'summary', value: expr('{{ $json.output.summary || "" }}'), type: 'string' },
          { id: 'm8', name: 'property', value: expr('{{ $json.output.property || "" }}'), type: 'string' },
          { id: 'm9', name: 'next_step', value: expr('{{ $json.output.next_step || "Review manually" }}'), type: 'string' },
          { id: 'm10', name: 'reply', value: expr('{{ $json.output.reply || "Thanks for your message. Our team will get back to you shortly." }}'), type: 'string' },
          { id: 'm11', name: 'needs_human', value: expr('{{ $json.output.needs_human === true || !["repair","lead"].includes($json.output.type) }}'), type: 'boolean' }
        ]
      }
    },
    position: [960, 420]
  },
  output: [{ contact_name: 'Daniel', contact: '+44 7700 900123', message: 'Water is coming through my bathroom ceiling', type: 'repair', priority: 'urgent', lead_score: 0, summary: 'Leak through bathroom ceiling', property: 'Flat 2, 14 Orford Road', next_step: 'On-call plumber to call tenant', reply: 'Sorry to hear that...', needs_human: false }]
});

const buildTicket = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Build Ticket',
    parameters: {
      mode: 'manual',
      includeOtherFields: true,
      assignments: {
        assignments: [
          { id: 'b1', name: 'ref', value: expr('{{ ($json.type === "lead" ? "LD-" : $json.type === "repair" ? "LR-" : "LO-") + $execution.id }}'), type: 'string' },
          { id: 'b2', name: 'hot_lead', value: expr('{{ $json.type === "lead" && $json.lead_score >= 70 }}'), type: 'boolean' },
          { id: 'b3', name: 'alert_team', value: expr('{{ $json.priority === "emergency" || ($json.type === "repair" && $json.priority === "urgent") || ($json.type === "lead" && $json.lead_score >= 70) || $json.needs_human === true }}'), type: 'boolean' },
          { id: 'b4', name: 'created_at', value: expr('{{ $now.toISO() }}'), type: 'string' }
        ]
      }
    },
    position: [1200, 300]
  },
  output: [{ contact_name: 'Daniel', contact: '+44 7700 900123', message: 'Water is coming through my bathroom ceiling', type: 'repair', priority: 'urgent', lead_score: 0, summary: 'Leak through bathroom ceiling', property: 'Flat 2, 14 Orford Road', next_step: 'On-call plumber to call tenant', reply: 'Sorry to hear that...', needs_human: false, ref: 'LR-301', hot_lead: false, alert_team: true, created_at: '2026-10-13T15:30:00.000+05:00' }]
});

const saveTicket = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Save to Team Board',
    parameters: {
      resource: 'row',
      operation: 'insert',
      dataTableId: { __rl: true, mode: 'id', value: 'YOUR_DATA_TABLE_ID', cachedResultName: 'DEMO_autopilot_tickets' },
      columns: {
        mappingMode: 'defineBelow',
        value: {
          ref: expr('{{ $json.ref }}'),
          contact_name: expr('{{ $json.contact_name }}'),
          contact: expr('{{ $json.contact }}'),
          message: expr('{{ $json.message }}'),
          type: expr('{{ $json.type }}'),
          priority: expr('{{ $json.priority }}'),
          lead_score: expr('{{ $json.lead_score }}'),
          summary: expr('{{ $json.summary }}'),
          property: expr('{{ $json.property }}'),
          next_step: expr('{{ $json.next_step }}'),
          reply: expr('{{ $json.reply }}'),
          needs_human: expr('{{ $json.needs_human }}'),
          created_at: expr('{{ $json.created_at }}')
        },
        schema: [
          { id: 'ref', displayName: 'ref', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'contact_name', displayName: 'contact_name', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'contact', displayName: 'contact', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'message', displayName: 'message', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'type', displayName: 'type', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'priority', displayName: 'priority', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'lead_score', displayName: 'lead_score', required: false, defaultMatch: false, display: true, type: 'number', canBeUsedToMatch: true },
          { id: 'summary', displayName: 'summary', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'property', displayName: 'property', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'next_step', displayName: 'next_step', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'reply', displayName: 'reply', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'needs_human', displayName: 'needs_human', required: false, defaultMatch: false, display: true, type: 'boolean', canBeUsedToMatch: true },
          { id: 'created_at', displayName: 'created_at', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }
        ]
      }
    },
    onError: 'continueRegularOutput',
    position: [1460, 120]
  },
  output: [{ id: 1 }]
});

const needsAlert = ifElse({
  version: 2.2,
  config: {
    name: 'Alert Team?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
        conditions: [{ leftValue: expr('{{ $json.alert_team }}'), operator: { type: 'boolean', operation: 'true', singleValue: true } }],
        combinator: 'and'
      }
    },
    position: [1460, 300]
  }
});

const alertEmail = node({
  type: 'n8n-nodes-base.gmail',
  version: 2.2,
  config: {
    name: 'Email Team Alert',
    parameters: {
      resource: 'message',
      operation: 'send',
      sendTo: 'you@example.com',
      subject: expr('{{ $json.priority === "emergency" ? "🚨 EMERGENCY" : $json.hot_lead ? "🔥 Hot lead" : $json.priority === "urgent" ? "🚨 Urgent repair" : "👀 Needs a person" }} · {{ $json.ref }} · {{ $json.summary }}'),
      emailType: 'html',
      message: expr('<p><b>{{ $json.ref }}</b> · {{ $json.type }} · {{ $json.priority }}{{ $json.type === "lead" ? " · score " + $json.lead_score : "" }}</p><p><b>From:</b> {{ $json.contact_name }} ({{ $json.contact }})<br><b>Property:</b> {{ $json.property || "-" }}</p><p><b>Message:</b><br>{{ $json.message }}</p><p><b>Next step:</b> {{ $json.next_step }}</p><p><b>Reply sent:</b><br>{{ $json.reply }}</p><p style="color:#777">Letting Agent Autopilot · demo</p>'),
      options: { appendAttribution: false }
    },
    credentials: { gmailOAuth2: { id: 'YOUR_CREDENTIAL_ID', name: 'Gmail account' } },
    onError: 'continueRegularOutput',
    position: [1700, 240]
  },
  output: [{ id: 'msg-1' }]
});

const respond = node({
  type: 'n8n-nodes-base.respondToWebhook',
  version: 1.5,
  config: {
    name: 'Send Reply Back',
    parameters: {
      respondWith: 'json',
      responseBody: expr('{{ { ref: $json.ref, type: $json.type, priority: $json.priority, lead_score: $json.lead_score, needs_human: $json.needs_human, alert_team: $json.alert_team, reply: $json.reply } }}')
    },
    position: [1460, 480]
  }
});

const note = sticky('## Letting Agent Autopilot (backend)\nPOST { name, contact, message } to the webhook.\n\n1. Gas / carbon monoxide words → fixed safety reply with 0800 111 999, never left to AI.\n2. Everything else → Gemini sorts it: repair (urgent / normal / low), renter lead (score 0–100) or other.\n3. Saved to DEMO_autopilot_tickets, urgent repairs and hot leads emailed to the team, reply returned to the sender.\n\nClient version: plug the official WhatsApp Cloud API in front of the webhook and send the reply back through it.', [], { color: 4, position: [-40, -140], width: 560, height: 300 });

export default workflow('letting-agent-autopilot', 'DEMO · Letting Agent Autopilot (Repairs + Leads)')
  .add(inbound)
  .to(normalize)
  .to(gasCheck
    .onTrue(emergency.to(buildTicket))
    .onFalse(triage.to(mapTriage.to(buildTicket))))
  .add(buildTicket)
  .to(saveTicket)
  .add(buildTicket)
  .to(needsAlert.onTrue(alertEmail))
  .add(buildTicket)
  .to(respond)
  .add(note);
