import { workflow, node, trigger, sticky, ifElse, splitInBatches, nextBatch, languageModel, outputParser, expr } from '@n8n/workflow-sdk';

const runNow = trigger({ type: 'n8n-nodes-base.manualTrigger', version: 1, config: { name: 'Run Now', position: [0, 200] }, output: [{}] });

const byCeo = trigger({ type: 'n8n-nodes-base.executeWorkflowTrigger', version: 1.3, config: { name: 'Called by CEO', parameters: { inputSource: 'passthrough' }, position: [0, 400] }, output: [{}] });

const getLeads = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Leads Waiting for Reply',
    parameters: {
      resource: 'row',
      operation: 'get',
      dataTableId: { __rl: true, mode: 'id', value: 'YOUR_DATA_TABLE_ID', cachedResultName: 'DEMO_agency_leads' },
      matchType: 'anyCondition',
      filters: {
        conditions: [
          { keyName: 'status', condition: 'eq', keyValue: 'Drafted' },
          { keyName: 'status', condition: 'eq', keyValue: 'Already contacted' }
        ]
      },
      returnAll: true
    },
    executeOnce: true,
    position: [240, 300]
  },
  output: [{ id: 4, agency: 'Neighbour', email: 'hello@example-lettings.co.uk', status: 'Already contacted', opener: '', followup_at: null, last_reply_id: null }]
});

const loop = splitInBatches({ version: 3, config: { name: 'One Lead at a Time', parameters: { batchSize: 1 }, position: [480, 300] } });

const done = node({ type: 'n8n-nodes-base.noOp', version: 1, config: { name: 'All Checked', position: [720, 80] }, output: [{}] });

const sentOld = node({
  type: 'n8n-nodes-base.gmail',
  version: 2.2,
  config: {
    name: 'First Email Sent 4+ Days Ago?',
    parameters: {
      resource: 'message',
      operation: 'getAll',
      returnAll: false,
      limit: 1,
      simple: true,
      filters: { q: expr('to:{{ $json.email }} in:sent older_than:4d'), readStatus: 'both' }
    },
    credentials: { gmailOAuth2: { id: 'YOUR_CREDENTIAL_ID', name: 'Gmail account' } },
    alwaysOutputData: true,
    onError: 'continueRegularOutput',
    position: [720, 300]
  },
  output: [{ id: 'm1', threadId: 't1', Subject: 'Tenant repair messages at Neighbour', To: 'hello@example-lettings.co.uk' }]
});

const readyIf = ifElse({
  version: 2.2,
  config: {
    name: 'Due for Follow-up?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
        conditions: [
          { leftValue: expr('{{ $json.id ?? "" }}'), operator: { type: 'string', operation: 'notEmpty', singleValue: true } },
          { leftValue: expr('{{ $("One Lead at a Time").item.json.followup_at ?? "" }}'), operator: { type: 'string', operation: 'empty', singleValue: true } },
          { leftValue: expr('{{ $("One Lead at a Time").item.json.last_reply_id ?? "" }}'), operator: { type: 'string', operation: 'empty', singleValue: true } }
        ],
        combinator: 'and'
      }
    },
    position: [940, 300]
  }
});

const anyReply = node({
  type: 'n8n-nodes-base.gmail',
  version: 2.2,
  config: {
    name: 'Any Reply Yet?',
    parameters: {
      resource: 'message',
      operation: 'getAll',
      returnAll: false,
      limit: 1,
      simple: true,
      filters: { q: expr("from:({{ (() => { const e = ($(\"One Lead at a Time\").item.json.email || \"\").toLowerCase(); const d = e.split(\"@\")[1] || \"\"; return /^(gmail|googlemail|outlook|hotmail|live|yahoo|icloud|aol|btinternet|sky)\\./.test(d) ? e : \"@\" + d; })() }}) -in:sent"), readStatus: 'both' }
    },
    credentials: { gmailOAuth2: { id: 'YOUR_CREDENTIAL_ID', name: 'Gmail account' } },
    alwaysOutputData: true,
    onError: 'continueRegularOutput',
    position: [1180, 200]
  },
  output: [{}]
});

const noReplyIf = ifElse({
  version: 2.2,
  config: {
    name: 'Still No Reply?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
        conditions: [{ leftValue: expr('{{ $json.id ?? "" }}'), operator: { type: 'string', operation: 'empty', singleValue: true } }],
        combinator: 'and'
      }
    },
    position: [1420, 200]
  }
});

const fuModel = languageModel({
  type: '@n8n/n8n-nodes-langchain.lmChatOpenAi',
  version: 1.3,
  config: {
    name: 'Follow-up Model',
    parameters: { model: { __rl: true, mode: 'list', value: 'gpt-5-mini' }, responsesApiEnabled: false, options: { reasoningEffort: 'low', timeout: 120000 } },
    position: [1660, 400]
  }
});

const fuParser = outputParser({
  type: '@n8n/n8n-nodes-langchain.outputParserStructured',
  version: 1.3,
  config: {
    name: 'Follow-up Text',
    parameters: { schemaType: 'fromJson', jsonSchemaExample: '{ "body": "Hi Neighbour team,\\n\\n..." }' },
    position: [1820, 400]
  }
});

const fuWriter = node({
  type: '@n8n/n8n-nodes-langchain.chainLlm',
  version: 1.9,
  config: {
    name: 'Follow-up Agent',
    parameters: {
      promptType: 'define',
      text: expr("You are the Follow-up agent in a small AI sales team. Ahmad Hassan, a freelance WhatsApp & n8n automation developer, emailed this UK letting agency at least 4 days ago and got no reply. Write ONE short, polite follow-up that will be sent in the same email thread.\n\nAgency: {{ $(\"One Lead at a Time\").item.json.agency }}\nFirst email subject: {{ $(\"First Email Sent 4+ Days Ago?\").item.json.Subject }}\nFirst email (may be empty): {{ $(\"One Lead at a Time\").item.json.email_body || \"(not stored: it offered a WhatsApp assistant that sorts tenant repair requests and replies to new renters, and a 50-second demo)\" }}\n\nRules:\n- 50 to 90 words, plain text, British English, no markdown, no exclamation marks.\n- Greeting \"Hi <short agency name> team,\".\n- One line that refers back to the earlier email without guilt-tripping (no \"just bumping\", no \"did you see\").\n- One concrete benefit: repair messages sorted by urgency, and new renter enquiries answered within a minute, even after hours.\n- Offer the 50-second demo on sample data and ask a simple yes or no question.\n- Say this is the last email unless they would like to see it.\n- Sign off with three lines: Best regards / Ahmad Hassan / WhatsApp & n8n Automation (each on its own line).\n- Final line exactly: If you'd rather not hear from me again, just reply \"no thanks\".\n- Never invent clients, results, statistics, prices or discounts. No words like free, guarantee, act now."),
      hasOutputParser: true
    },
    subnodes: { model: fuModel, outputParser: fuParser },
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 5000,
    position: [1660, 200]
  },
  output: [{ output: { body: 'Hi Neighbour team,...' } }]
});

const fuDraft = node({
  type: 'n8n-nodes-base.gmail',
  version: 2.2,
  config: {
    name: 'Draft Follow-up in Thread',
    parameters: {
      resource: 'draft',
      operation: 'create',
      subject: expr('{{ ($("First Email Sent 4+ Days Ago?").item.json.Subject || "").startsWith("Re:") ? $("First Email Sent 4+ Days Ago?").item.json.Subject : "Re: " + ($("First Email Sent 4+ Days Ago?").item.json.Subject || "") }}'),
      emailType: 'text',
      message: expr('{{ $json.output.body }}'),
      options: {
        threadId: expr('{{ $("First Email Sent 4+ Days Ago?").item.json.threadId }}'),
        sendTo: expr('{{ $("One Lead at a Time").item.json.email }}')
      }
    },
    credentials: { gmailOAuth2: { id: 'YOUR_CREDENTIAL_ID', name: 'Gmail account' } },
    position: [1900, 200]
  },
  output: [{ id: 'd1', message: { id: 'm2', threadId: 't1' } }]
});

const markFu = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Mark Follow-up Drafted',
    parameters: {
      resource: 'row',
      operation: 'update',
      dataTableId: { __rl: true, mode: 'id', value: 'YOUR_DATA_TABLE_ID', cachedResultName: 'DEMO_agency_leads' },
      matchType: 'allConditions',
      filters: { conditions: [{ keyName: 'id', condition: 'eq', keyValue: expr('{{ $("One Lead at a Time").item.json.id }}') }] },
      columns: {
        mappingMode: 'defineBelow',
        value: { status: 'Follow-up drafted', followup_at: expr('{{ $now.toISO() }}') },
        schema: [
          { id: 'status', displayName: 'status', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'followup_at', displayName: 'followup_at', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }
        ]
      }
    },
    position: [2140, 200]
  },
  output: [{ id: 4, status: 'Follow-up drafted' }]
});

const note = sticky('## AI Sales Team · Follow-up Agent\nRun by the CEO workflow each weekday (or Run Now).\n1. Looks at leads we emailed (Drafted / Already contacted).\n2. Only continues if the first email was actually sent 4+ days ago, no follow-up was made yet, and the agency has not replied.\n3. Follow-up agent writes one short, polite note.\n4. Saved as a Gmail draft in the same thread. Ahmad presses Send.\nOnly ONE follow-up per agency, ever.', [], { color: 4, position: [-40, -260], width: 560, height: 260 });

export default workflow('ai-sales-team-follow-up', 'AI Sales Team · Follow-up Agent')
  .add(runNow)
  .to(getLeads)
  .add(byCeo)
  .to(getLeads)
  .to(loop
    .onDone(done)
    .onEachBatch(sentOld.to(readyIf
      .onTrue(anyReply.to(noReplyIf
        .onTrue(fuWriter.to(fuDraft.to(markFu.to(nextBatch(loop)))))
        .onFalse(nextBatch(loop))))
      .onFalse(nextBatch(loop)))))
  .add(note);
