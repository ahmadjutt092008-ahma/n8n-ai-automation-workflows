import { workflow, node, trigger, sticky, languageModel, memory, tool, vectorStore, embeddings, documentLoader, expr } from '@n8n/workflow-sdk';

const geminiEmbedA = embeddings({
  type: '@n8n/n8n-nodes-langchain.embeddingsGoogleGemini',
  version: 1,
  config: {
    name: 'Gemini Embeddings (sample)',
    parameters: { modelName: 'models/gemini-embedding-001' },
    credentials: { googlePalmApi: { id: 'YOUR_CREDENTIAL_ID', name: 'Google Gemini(PaLM) Api account 2' } },
    position: [520, 160]
  }
});

const geminiEmbedB = embeddings({
  type: '@n8n/n8n-nodes-langchain.embeddingsGoogleGemini',
  version: 1,
  config: {
    name: 'Gemini Embeddings (upload)',
    parameters: { modelName: 'models/gemini-embedding-001' },
    credentials: { googlePalmApi: { id: 'YOUR_CREDENTIAL_ID', name: 'Google Gemini(PaLM) Api account 2' } },
    position: [520, 560]
  }
});

const geminiEmbedC = embeddings({
  type: '@n8n/n8n-nodes-langchain.embeddingsGoogleGemini',
  version: 1,
  config: {
    name: 'Gemini Embeddings (search)',
    parameters: { modelName: 'models/gemini-embedding-001' },
    credentials: { googlePalmApi: { id: 'YOUR_CREDENTIAL_ID', name: 'Google Gemini(PaLM) Api account 2' } },
    position: [700, 1040]
  }
});

const sampleLoader = documentLoader({
  type: '@n8n/n8n-nodes-langchain.documentDefaultDataLoader',
  version: 1.1,
  config: {
    name: 'Sample Text Loader',
    parameters: {
      dataType: 'json',
      jsonMode: 'expressionData',
      jsonData: expr('{{ $json.text }}'),
      textSplittingMode: 'simple',
      options: { metadata: { metadataValues: [{ name: 'source', value: expr('{{ $json.source }}') }] } }
    },
    position: [680, 160]
  }
});

const uploadLoader = documentLoader({
  type: '@n8n/n8n-nodes-langchain.documentDefaultDataLoader',
  version: 1.1,
  config: {
    name: 'Uploaded File Loader',
    parameters: {
      dataType: 'binary',
      binaryMode: 'allInputData',
      loader: 'auto',
      textSplittingMode: 'simple',
      options: { splitPages: true }
    },
    position: [680, 560]
  }
});

const loadSample = trigger({
  type: 'n8n-nodes-base.manualTrigger',
  version: 1,
  config: { name: 'Load Sample Handbook', position: [0, 0] },
  output: [{}]
});

const sampleText = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Sample Company Handbook',
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: {
        assignments: [
          { id: 's1', name: 'source', value: 'Oakline Lettings handbook (sample)', type: 'string' },
          { id: 's2', name: 'text', value: 'OAKLINE LETTINGS · TENANT AND LANDLORD HANDBOOK (fictional sample company for demo use)\n\nOffice hours: Monday to Friday 9:00 to 17:30, Saturday 10:00 to 14:00. Closed Sundays and bank holidays.\n\nRent: Rent is due on the date shown in your tenancy agreement and is paid by standing order. If a payment will be late, tell the accounts team before the due date.\n\nDeposits: Deposits are protected with the Deposit Protection Service (DPS) within 30 days of receipt. For annual rent under £50,000 the deposit is capped at 5 weeks of rent. A holding deposit to reserve a property is capped at 1 week of rent.\n\nReporting repairs: Report repairs through WhatsApp or the tenant portal with a photo. Urgent repairs (water leaks, no heating or hot water, no power, security problems) are attended within 24 hours. Routine repairs are booked within 5 working days.\n\nEmergencies: If you smell gas, leave the property and call the National Gas Emergency Service on 0800 111 999. For fire or danger to life call 999. Out of hours urgent repairs go to the on-call line given in your move-in pack.\n\nPets: Pets are considered case by case with the landlord. Ask before bringing a pet. A pet clause may be added to the tenancy.\n\nViewings: Viewings run Monday to Saturday. Please bring photo ID. After a viewing, applicants can submit an application and holding deposit online.\n\nReferencing: Applicants are referenced for identity, right to rent, income (usually 30 times the monthly rent per year) and previous landlord. A UK-based guarantor may be accepted if income is below the requirement.\n\nEnding a tenancy: In a periodic tenancy, tenants give at least one month written notice ending on the last day of a rental period, unless the agreement says otherwise.\n\nCheck-out: A check-out inspection compares the property against the inventory. Fair wear and tear is allowed. Deposit deductions are itemised and can be disputed through the DPS.', type: 'string' }
        ]
      }
    },
    position: [240, 0]
  },
  output: [{ source: 'Oakline Lettings handbook (sample)', text: 'OAKLINE LETTINGS handbook...' }]
});

const insertSample = vectorStore({
  type: '@n8n/n8n-nodes-langchain.vectorStoreInMemory',
  version: 1.3,
  config: {
    name: 'Add Sample to Knowledge Base',
    parameters: { mode: 'insert', memoryKey: { __rl: true, mode: 'id', value: 'company_kb' }, clearStore: true },
    subnodes: { embedding: geminiEmbedA, documentLoader: sampleLoader },
    position: [520, 0]
  }
});

const uploadForm = trigger({
  type: 'n8n-nodes-base.formTrigger',
  version: 2.6,
  config: {
    name: 'Upload Company Documents',
    parameters: {
      formTitle: 'Add documents to the AI knowledge base (Demo)',
      formDescription: 'Upload PDF, Word or text files such as a handbook, FAQ or price list. The assistant will answer questions from them.',
      formFields: {
        values: [
          { fieldLabel: 'Documents', fieldName: 'Documents', fieldType: 'file', multipleFiles: true, acceptFileTypes: '.pdf,.docx,.txt,.md', requiredField: true }
        ]
      },
      responseMode: 'lastNode',
      options: { buttonLabel: 'Add to knowledge base', path: 'ai-knowledge-upload', appendAttribution: false }
    },
    position: [0, 400]
  },
  output: [{ Documents: [{ filename: 'handbook.pdf', mimetype: 'application/pdf', size: 52000 }], submittedAt: '2026-10-13T10:00:00.000+05:00' }]
});

const insertUpload = vectorStore({
  type: '@n8n/n8n-nodes-langchain.vectorStoreInMemory',
  version: 1.3,
  config: {
    name: 'Add Upload to Knowledge Base',
    parameters: { mode: 'insert', memoryKey: { __rl: true, mode: 'id', value: 'company_kb' }, clearStore: false },
    subnodes: { embedding: geminiEmbedB, documentLoader: uploadLoader },
    position: [520, 400]
  }
});

const uploadDone = node({
  type: 'n8n-nodes-base.form',
  version: 2.5,
  config: {
    name: 'Upload Done',
    parameters: {
      operation: 'completion',
      respondWith: 'text',
      completionTitle: 'Added to the knowledge base',
      completionMessage: expr('{{ $input.all().length }} text chunks were added. You can now ask the assistant about them.')
    },
    executeOnce: true,
    position: [800, 400]
  }
});

const chat = trigger({
  type: '@n8n/n8n-nodes-langchain.chatTrigger',
  version: 1.5,
  config: {
    name: 'Ask the Assistant',
    parameters: {
      public: true,
      mode: 'hostedChat',
      authentication: 'none',
      initialMessages: "Hi! I answer questions using this company's own documents.\nTry: How much is the holding deposit? or What counts as an urgent repair?",
      options: { title: 'Company Knowledge Assistant', subtitle: 'Demo · answers only from uploaded documents', inputPlaceholder: 'Ask a question…', responseMode: 'lastNode' }
    },
    position: [0, 820]
  },
  output: [{ sessionId: 'abc123', action: 'sendMessage', chatInput: 'How much is the holding deposit?' }]
});

const chatModel = languageModel({
  type: '@n8n/n8n-nodes-langchain.lmChatGoogleGemini',
  version: 1.2,
  config: {
    name: 'Gemini Chat Model',
    parameters: { modelName: 'models/gemini-3.8-flash', options: { temperature: 0.2, maxOutputTokens: 1024 } },
    credentials: { googlePalmApi: { id: 'YOUR_CREDENTIAL_ID', name: 'Google Gemini(PaLM) Api account 2' } },
    position: [240, 1040]
  }
});

const chatMemory = memory({
  type: '@n8n/n8n-nodes-langchain.memoryBufferWindow',
  version: 1.4,
  config: { name: 'Chat Memory', parameters: { sessionIdType: 'fromInput', contextWindowLength: 6 }, position: [400, 1040] }
});

const kbSearch = tool({
  type: '@n8n/n8n-nodes-langchain.vectorStoreInMemory',
  version: 1.3,
  config: {
    name: 'company_documents',
    parameters: {
      mode: 'retrieve-as-tool',
      toolDescription: 'Search the company documents (handbook, policies, FAQ, price list). Use it for every question about the company, its rules, prices, processes or contact details.',
      memoryKey: { __rl: true, mode: 'id', value: 'company_kb' },
      topK: 5,
      includeDocumentMetadata: true
    },
    subnodes: { embedding: geminiEmbedC },
    position: [560, 1040]
  }
});

const assistant = node({
  type: '@n8n/n8n-nodes-langchain.agent',
  version: 3.1,
  config: {
    name: 'Knowledge Assistant',
    parameters: {
      promptType: 'auto',
      options: {
        systemMessage: 'You are a customer assistant for a company. Answer ONLY from what the company_documents tool returns.\n\nRules:\n- Always call company_documents before answering a question about the company.\n- If the documents do not contain the answer, say you do not have that information and offer to pass the question to the team. Never guess, and never use outside knowledge for prices, policies or dates.\n- Keep answers short and clear (2 to 5 sentences), in the language the user writes in.\n- End factual answers with the source name in brackets, for example (Source: Oakline Lettings handbook).\n- For emergencies such as a gas smell, give the emergency number from the documents first.',
        maxIterations: 5,
        enableStreaming: false
      }
    },
    subnodes: { model: chatModel, memory: chatMemory, tools: [kbSearch] },
    position: [400, 820]
  },
  output: [{ output: 'The holding deposit is capped at 1 week of rent. (Source: Oakline Lettings handbook)' }]
});

const note = sticky('## AI Knowledge Assistant (RAG)\n1. Click "Load Sample Handbook" once (or upload your own files with the form).\n2. Open the public chat and ask questions.\n\nThe assistant searches the documents first and only answers from them. If the answer is not there it says so instead of guessing.\n\nDemo uses the Simple Vector Store, which resets when n8n restarts. Client version: Pinecone, Qdrant or Supabase so the knowledge stays saved.', [], { color: 4, position: [-60, -340], width: 560, height: 300 });

export default workflow('ai-knowledge-assistant', 'DEMO · AI Knowledge Assistant (Docs → Answers)')
  .add(loadSample)
  .to(sampleText)
  .to(insertSample)
  .add(uploadForm)
  .to(insertUpload)
  .to(uploadDone)
  .add(chat)
  .to(assistant)
  .add(note);
