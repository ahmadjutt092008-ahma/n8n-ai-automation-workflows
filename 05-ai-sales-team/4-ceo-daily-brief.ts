import { workflow, node, trigger, sticky, languageModel, expr } from '@n8n/workflow-sdk';

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

const runWriter = node({
  type: 'n8n-nodes-base.executeWorkflow',
  version: 1.4,
  config: {
    name: 'Writer + QA Team',
    parameters: {
      source: 'database',
      workflowId: { __rl: true, mode: 'id', value: 'YOUR_DATA_TABLE_ID', cachedResultName: 'AI Sales Team · Writer + QA (Drafts)' },
      mode: 'once',
      options: { waitForSubWorkflow: true }
    },
    executeOnce: true,
    alwaysOutputData: true,
    onError: 'continueRegularOutput',
    position: [260, 300]
  },
  output: [{}]
});

const runFollowup = node({
  type: 'n8n-nodes-base.executeWorkflow',
  version: 1.4,
  config: {
    name: 'Follow-up Agent',
    parameters: {
      source: 'database',
      workflowId: { __rl: true, mode: 'id', value: 'YOUR_DATA_TABLE_ID', cachedResultName: 'AI Sales Team · Follow-up Agent' },
      mode: 'once',
      options: { waitForSubWorkflow: true }
    },
    executeOnce: true,
    alwaysOutputData: true,
    onError: 'continueRegularOutput',
    position: [500, 300]
  },
  output: [{}]
});

const allLeads = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Read Pipeline',
    parameters: {
      resource: 'row',
      operation: 'get',
      dataTableId: { __rl: true, mode: 'id', value: 'YOUR_DATA_TABLE_ID', cachedResultName: 'DEMO_agency_leads' },
      matchType: 'allConditions',
      filters: { conditions: [{ keyName: 'agency', condition: 'isNotEmpty' }] },
      returnAll: true
    },
    executeOnce: true,
    position: [740, 300]
  },
  output: [{ id: 4, agency: 'Neighbour', status: 'Drafted', fit_score: 80, reply_category: null }]
});

const numbers = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Pipeline Numbers',
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: "const rows = $input.all().map(i => i.json).filter(r => !String(r.agency || '').startsWith('TEST'));\nconst by = s => rows.filter(r => r.status === s);\nconst names = list => list.map(r => r.agency).slice(0, 15);\nconst today = new Date().toISOString().slice(0, 10);\nreturn [{ json: {\n  total: rows.length,\n  drafts_to_send: names(by('Drafted').filter(r => String(r.drafted_at || '').slice(0, 10) === today)),\n  all_drafted_not_sent_check: by('Drafted').length,\n  followups_to_send: names(by('Follow-up drafted').filter(r => String(r.followup_at || '').slice(0, 10) === today)),\n  replied: rows.filter(r => r.status === 'Replied').map(r => ({ agency: r.agency, category: r.reply_category, summary: r.reply_summary })),\n  not_interested: by('Not interested').length,\n  needs_review: names(by('Needs review')),\n  ready_to_email: by('Ready to email').length,\n  ai_retry: names(by('AI busy - retry')),\n  no_public_email: names(by('No public email')),\n  already_contacted: by('Already contacted').length,\n  followed_up_total: by('Follow-up drafted').length\n} }];"
    },
    position: [980, 300]
  },
  output: [{ total: 20, drafts_to_send: ['Neighbour'], replied: [], ready_to_email: 0 }]
});

const ceoModel = languageModel({
  type: '@n8n/n8n-nodes-langchain.lmChatOpenAi',
  version: 1.3,
  config: {
    name: 'CEO Model',
    parameters: { model: { __rl: true, mode: 'list', value: 'gpt-5-mini' }, responsesApiEnabled: false, options: { reasoningEffort: 'low', timeout: 120000 } },
    position: [1220, 520]
  }
});

const ceo = node({
  type: '@n8n/n8n-nodes-langchain.chainLlm',
  version: 1.9,
  config: {
    name: 'CEO Agent',
    parameters: {
      promptType: 'define',
      text: expr("You are the CEO agent of a small AI sales team working for Ahmad Hassan, a freelance WhatsApp & n8n automation developer in Pakistan who is looking for his first UK letting agency clients. The Writer, QA and Follow-up agents have just run. Here are today's pipeline numbers as JSON:\n\n{{ JSON.stringify($json) }}\n\nWrite Ahmad's daily brief as simple HTML (only <p>, <b>, <ul>, <li>, <br>). Keep it under 180 words. Use plain, friendly English.\n\nStructure:\n1. One line: the pipeline in numbers (total leads, contacted, replies, not interested).\n2. <b>Do today</b>: a numbered priority list of at most 4 actions, most important first. Replies always come first (name each agency and what they want). Then sending today's drafts and follow-ups from Gmail Drafts between 1 pm and 6 pm Pakistan time (name the agencies). Then leads that need review. If ready_to_email is 0 and there are few drafts, tell him to add 5 to 10 new agencies in the Agency Lead Finder form. If ai_retry has names, tell him to run those again in the Lead Finder.\n3. One short line of encouragement based only on real numbers. Never invent numbers, replies or names that are not in the JSON."),
      hasOutputParser: false
    },
    subnodes: { model: ceoModel },
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 5000,
    position: [1220, 300]
  },
  output: [{ text: '<p>Pipeline: ...</p>' }]
});

const brief = node({
  type: 'n8n-nodes-base.gmail',
  version: 2.2,
  config: {
    name: 'Send Daily Brief',
    parameters: {
      resource: 'message',
      operation: 'send',
      sendTo: 'you@example.com',
      subject: expr('AI Sales Team brief: {{ $("Pipeline Numbers").item.json.replied.length }} replies, {{ $("Pipeline Numbers").item.json.drafts_to_send.length + $("Pipeline Numbers").item.json.followups_to_send.length }} drafts to send'),
      emailType: 'html',
      message: expr('{{ $json.text }}<hr><p style="color:#888;font-size:12px">Sent by your AI Sales Team (CEO agent). Nothing is ever sent to agencies without you pressing Send.</p>'),
      options: { appendAttribution: false }
    },
    credentials: { gmailOAuth2: { id: 'YOUR_CREDENTIAL_ID', name: 'Gmail account' } },
    position: [1460, 300]
  },
  output: [{ id: 'msg-1' }]
});

const note = sticky('## AI Sales Team · CEO\nWeekdays 1:30 pm PKT (or Run Now):\n1. Runs the Writer + QA team (new lead emails as Gmail drafts).\n2. Runs the Follow-up agent (one follow-up after 4+ days, no reply).\n3. Reads the whole pipeline.\n4. CEO agent writes Ahmad a short daily brief with today\'s priorities.\nThe Reply Watcher runs on its own every 2 hours and alerts instantly.\nHuman in the loop: agents only create drafts.', [], { color: 4, position: [-40, -260], width: 560, height: 260 });

export default workflow('ai-sales-team-ceo', 'AI Sales Team · CEO (Daily Run + Brief)')
  .add(runNow)
  .to(runWriter)
  .add(daily)
  .to(runWriter)
  .to(runFollowup)
  .to(allLeads)
  .to(numbers)
  .to(ceo)
  .to(brief)
  .add(note);
