import { workflow, node, trigger, sticky, ifElse, splitInBatches, nextBatch, languageModel, outputParser, expr } from '@n8n/workflow-sdk';

const TABLE = { __rl: true, mode: 'id', value: 'YOUR_DATA_TABLE_ID', cachedResultName: 'DEMO_agency_leads' } as const;
const GMAIL = { gmailOAuth2: { id: 'YOUR_CREDENTIAL_ID', name: 'Gmail account' } };
const col = (id: string) => ({ id, displayName: id, required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true });
const LEAD = '$("One Lead at a Time").item.json';
const DOMAIN_Q = `{{ (() => { const e = (${LEAD}.email || "").toLowerCase(); const d = e.split("@")[1] || ""; return /^(gmail|googlemail|outlook|hotmail|live|yahoo|icloud|aol|btinternet|sky)\\./.test(d) ? e : "@" + d; })() }}`;

const runNow = trigger({ type: 'n8n-nodes-base.manualTrigger', version: 1, config: { name: 'Run Now', position: [0, 200] }, output: [{}] });

const every2h = trigger({
  type: 'n8n-nodes-base.scheduleTrigger',
  version: 1.4,
  config: {
    name: 'Every 2 Hours (9am-11pm PKT)',
    parameters: { rule: { interval: [{ field: 'cronExpression', expression: '0 5 9-23/2 * * *' }] } },
    position: [0, 400]
  },
  output: [{}]
});

const getLeads = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Leads We Emailed',
    parameters: {
      resource: 'row',
      operation: 'get',
      dataTableId: TABLE,
      matchType: 'anyCondition',
      filters: {
        conditions: [
          { keyName: 'status', condition: 'eq', keyValue: 'Drafted' },
          { keyName: 'status', condition: 'eq', keyValue: 'Already contacted' },
          { keyName: 'status', condition: 'eq', keyValue: 'Follow-up drafted' },
          { keyName: 'status', condition: 'eq', keyValue: 'Replied' }
        ]
      },
      returnAll: true
    },
    position: [240, 300]
  },
  output: [{ id: 4, agency: 'Neighbour', email: 'hello@example-lettings.co.uk', status: 'Already contacted', last_reply_id: null, email_body: null, opener: '' }]
});

const loop = splitInBatches({ version: 3, config: { name: 'One Lead at a Time', parameters: { batchSize: 1 }, position: [480, 300] } });

const done = node({ type: 'n8n-nodes-base.noOp', version: 1, config: { name: 'All Checked', position: [720, 80] }, output: [{}] });

const findReply = node({
  type: 'n8n-nodes-base.gmail',
  version: 2.2,
  config: {
    name: 'Find Latest Reply',
    parameters: {
      resource: 'message',
      operation: 'getAll',
      returnAll: false,
      limit: 1,
      simple: false,
      filters: { q: expr(`from:(${DOMAIN_Q}) -in:sent newer_than:21d`), readStatus: 'both' },
      options: {}
    },
    credentials: GMAIL,
    alwaysOutputData: true,
    onError: 'continueRegularOutput',
    position: [720, 300]
  },
  output: [{ id: 'm1', threadId: 't1', subject: 'Re: Tenant repair messages', text: 'Hi Ahmad, yes please send the demo.', from: { value: [{ address: 'hello@example-lettings.co.uk', name: 'Sam' }] }, date: '2026-10-16T10:00:00Z' }]
});

const isNew = ifElse({
  version: 2.2,
  config: {
    name: 'New Reply?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
        conditions: [
          { leftValue: expr('{{ $json.id ?? "" }}'), operator: { type: 'string', operation: 'notEmpty', singleValue: true } },
          { leftValue: expr('{{ $json.id ?? "" }}'), rightValue: expr(`{{ ${LEAD}.last_reply_id ?? "" }}`), operator: { type: 'string', operation: 'notEquals' } }
        ],
        combinator: 'and'
      }
    },
    position: [940, 300]
  }
});

const replyModel = languageModel({
  type: '@n8n/n8n-nodes-langchain.lmChatOpenAi',
  version: 1.3,
  config: {
    name: 'Reply Model',
    parameters: { model: { __rl: true, mode: 'list', value: 'gpt-5-mini' }, responsesApiEnabled: false, options: { reasoningEffort: 'low', timeout: 120000 } },
    position: [1180, 520]
  }
});

const replyParser = outputParser({
  type: '@n8n/n8n-nodes-langchain.outputParserStructured',
  version: 1.3,
  config: {
    name: 'Reply Verdict',
    parameters: { schemaType: 'fromJson', jsonSchemaExample: '{ "category": "interested", "summary": "Sam wants the demo and asks about price.", "reply_needed": true, "reply_body": "Hi Sam,\\n\\n..." }' },
    position: [1340, 520]
  }
});

const replyAgent = node({
  type: '@n8n/n8n-nodes-langchain.chainLlm',
  version: 1.9,
  config: {
    name: 'Reply Agent',
    parameters: {
      promptType: 'define',
      text: expr(`You are the Reply agent in a small AI sales team for Ahmad Hassan, a freelance WhatsApp & n8n automation developer who emailed UK letting agencies.

Agency: {{ ${LEAD}.agency }}
Our email to them (may be empty): {{ ${LEAD}.email_body || "(not stored)" }}

Their message:
Subject: {{ $json.subject }}
From: {{ $json.from?.value?.[0]?.name || "" }} <{{ $json.from?.value?.[0]?.address || "" }}>
{{ ($json.text || $json.snippet || "").slice(0, 4000) }}

Classify into exactly one category:
- interested: wants the demo, more info, or is open to it
- meeting: proposes or accepts a call or meeting
- question: asks something specific (price, how it works, GDPR) without clearly saying yes
- not_interested: says no, unsubscribe, "no thanks", or asks not to be contacted
- auto_reply: out-of-office, automatic acknowledgement, ticket number, delivery failure
- other: anything else

summary: one short sentence on what they said.

reply_needed: true for interested, meeting, question, other. false for not_interested and auto_reply.

reply_body: if reply_needed, write a short plain-text reply in British English (50 to 120 words) for Ahmad to review and send:
- Greet the person by first name if shown, else "Hi <agency> team,".
- Answer only what they asked. Never invent prices, clients, results, dates or features. If they ask the price, say it depends on the setup and suggest a 15-minute call to scope it.
- If they want the demo, say the 50-second demo video link is below and leave the line "[DEMO LINK]" for Ahmad to paste.
- If they want a call, ask for two times that suit them this week (UK time) and say Ahmad will send a calendar invite.
- Sign off: Best regards,\\nAhmad Hassan\\nWhatsApp & n8n Automation
- No markdown, no exclamation marks.
If reply_needed is false, reply_body is an empty string.`),
      hasOutputParser: true
    },
    subnodes: { model: replyModel, outputParser: replyParser },
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 5000,
    position: [1180, 300]
  },
  output: [{ output: { category: 'interested', summary: 'Wants the demo.', reply_needed: true, reply_body: 'Hi Sam,...' } }]
});

const needDraft = ifElse({
  version: 2.2,
  config: {
    name: 'Draft a Reply?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
        conditions: [{ leftValue: expr('{{ $json.output.reply_needed }}'), operator: { type: 'boolean', operation: 'true', singleValue: true } }],
        combinator: 'and'
      }
    },
    position: [1420, 300]
  }
});

const draftReply = node({
  type: 'n8n-nodes-base.gmail',
  version: 2.2,
  config: {
    name: 'Draft Reply in Thread',
    parameters: {
      resource: 'draft',
      operation: 'create',
      subject: expr('{{ ($("Find Latest Reply").item.json.subject || "").startsWith("Re:") ? $("Find Latest Reply").item.json.subject : "Re: " + ($("Find Latest Reply").item.json.subject || "") }}'),
      emailType: 'text',
      message: expr('{{ $json.output.reply_body }}'),
      options: {
        threadId: expr('{{ $("Find Latest Reply").item.json.threadId }}'),
        sendTo: expr('{{ $("Find Latest Reply").item.json.from?.value?.[0]?.address }}')
      }
    },
    credentials: GMAIL,
    position: [1660, 200]
  },
  output: [{ id: 'd1', message: { id: 'm2', threadId: 't1' } }]
});

const updateLead = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Save Reply on Lead',
    parameters: {
      resource: 'row',
      operation: 'update',
      dataTableId: TABLE,
      matchType: 'allConditions',
      filters: { conditions: [{ keyName: 'id', condition: 'eq', keyValue: expr(`{{ ${LEAD}.id }}`) }] },
      columns: {
        mappingMode: 'defineBelow',
        value: {
          status: expr(`{{ $("Reply Agent").item.json.output.category === "not_interested" ? "Not interested" : ($("Reply Agent").item.json.output.category === "auto_reply" ? ${LEAD}.status : "Replied") }}`),
          last_reply_id: expr('{{ $("Find Latest Reply").item.json.id }}'),
          reply_category: expr('{{ $("Reply Agent").item.json.output.category }}'),
          reply_summary: expr('{{ $("Reply Agent").item.json.output.summary }}'),
          replied_at: expr('{{ $now.toISO() }}')
        },
        schema: [col('status'), col('last_reply_id'), col('reply_category'), col('reply_summary'), col('replied_at')]
      }
    },
    position: [1900, 300]
  },
  output: [{ id: 4, status: 'Replied' }]
});

const alertIf = ifElse({
  version: 2.2,
  config: {
    name: 'Tell Ahmad?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
        conditions: [{ leftValue: expr('{{ $("Reply Agent").item.json.output.category }}'), rightValue: 'auto_reply', operator: { type: 'string', operation: 'notEquals' } }],
        combinator: 'and'
      }
    },
    position: [2140, 300]
  }
});

const alert = node({
  type: 'n8n-nodes-base.gmail',
  version: 2.2,
  config: {
    name: 'Alert Ahmad',
    parameters: {
      resource: 'message',
      operation: 'send',
      sendTo: 'you@example.com',
      subject: expr(`{{ $("Reply Agent").item.json.output.category === "not_interested" ? "Lead said no" : "REPLY" }}: {{ ${LEAD}.agency }} ({{ $("Reply Agent").item.json.output.category }})`),
      emailType: 'html',
      message: expr(`<p><b>{{ ${LEAD}.agency }}</b> replied.</p><p><b>Category:</b> {{ $("Reply Agent").item.json.output.category }}<br><b>Summary:</b> {{ $("Reply Agent").item.json.output.summary }}</p><p><b>Their message:</b><br>{{ ($("Find Latest Reply").item.json.text || "").slice(0, 1500).replace(/\\n/g, "<br>") }}</p>{{ $("Reply Agent").item.json.output.reply_needed ? "<p><b>Next step:</b> a reply draft is waiting in Gmail Drafts in the same thread. Check it, paste the demo link if needed, and press Send.</p>" : "<p>No reply drafted. They will not be emailed again.</p>" }}`),
      options: { appendAttribution: false }
    },
    credentials: GMAIL,
    onError: 'continueRegularOutput',
    position: [2380, 200]
  },
  output: [{ id: 'msg-1' }]
});

const note = sticky('## AI Sales Team · Reply Watcher\nEvery 2 hours (9 am to 11 pm PKT):\n1. Looks at every agency we have emailed.\n2. Searches Gmail for a new message from their domain.\n3. Reply agent classifies it (interested, meeting, question, not interested, auto reply) and drafts an answer in the same thread.\n4. Saves the result on the lead and emails Ahmad an alert.\nNothing is sent to the agency automatically. "Not interested" leads are never emailed again.', [], { color: 4, position: [-40, -260], width: 560, height: 260 });

export default workflow('ai-sales-team-reply-watcher', 'AI Sales Team · Reply Watcher')
  .add(runNow)
  .to(getLeads)
  .add(every2h)
  .to(getLeads)
  .to(loop
    .onDone(done)
    .onEachBatch(findReply.to(isNew
      .onTrue(replyAgent.to(needDraft
        .onTrue(draftReply.to(updateLead.to(alertIf
          .onTrue(alert.to(nextBatch(loop)))
          .onFalse(nextBatch(loop)))))
        .onFalse(updateLead)))
      .onFalse(nextBatch(loop)))))
  .add(note);
