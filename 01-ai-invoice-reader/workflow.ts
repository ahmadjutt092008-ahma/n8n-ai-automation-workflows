import { workflow, node, trigger, sticky, ifElse, languageModel, outputParser, expr } from '@n8n/workflow-sdk';

const uploadForm = trigger({
  type: 'n8n-nodes-base.formTrigger',
  version: 2.6,
  config: {
    name: 'Upload Invoice',
    parameters: {
      formTitle: 'AI Invoice Reader (Demo)',
      formDescription: 'Upload a PDF invoice. AI reads it, pulls out the key fields, checks the totals and saves one clean row. Use sample invoices only.',
      formFields: {
        values: [
          { fieldLabel: 'Invoice', fieldName: 'Invoice', fieldType: 'file', multipleFiles: false, acceptFileTypes: '.pdf', requiredField: true }
        ]
      },
      responseMode: 'lastNode',
      options: { buttonLabel: 'Read invoice', path: 'ai-invoice-reader', appendAttribution: false }
    },
    position: [0, 300]
  },
  output: [{ Invoice: [{ filename: 'invoice-1001.pdf', mimetype: 'application/pdf', size: 24000 }], submittedAt: '2026-10-13T10:00:00.000+05:00', formMode: 'test' }]
});

const extractPdf = node({
  type: 'n8n-nodes-base.extractFromFile',
  version: 1.1,
  config: {
    name: 'Extract PDF Text',
    parameters: { operation: 'pdf', binaryPropertyName: 'Invoice', options: { joinPages: true } },
    position: [240, 300]
  },
  output: [{ numpages: 1, text: 'Northwind Supplies Ltd  Invoice INV-1001  Date 01/10/2026  Due 31/10/2026  2 x Printer toner @ 45.00 = 90.00  Subtotal 90.00  VAT 20% 18.00  Total GBP 108.00' }]
});

const hasText = ifElse({
  version: 2.2,
  config: {
    name: 'Has Readable Text?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
        conditions: [{ leftValue: expr('{{ ($json.text || "").trim().length }}'), operator: { type: 'number', operation: 'gt' }, rightValue: 20 }],
        combinator: 'and'
      }
    },
    position: [480, 300]
  }
});

const geminiModel = languageModel({
  type: '@n8n/n8n-nodes-langchain.lmChatGoogleGemini',
  version: 1.2,
  config: {
    name: 'Gemini Model',
    parameters: { modelName: 'models/gemini-3.8-flash', options: { temperature: 0, maxOutputTokens: 2048 } },
    credentials: { googlePalmApi: { id: 'YOUR_CREDENTIAL_ID', name: 'Google Gemini(PaLM) Api account 2' } },
    position: [700, 520]
  }
});

const invoiceParser = outputParser({
  type: '@n8n/n8n-nodes-langchain.outputParserStructured',
  version: 1.3,
  config: {
    name: 'Invoice Fields',
    parameters: {
      schemaType: 'fromJson',
      jsonSchemaExample: '{ "vendor": "Northwind Supplies Ltd", "invoice_number": "INV-1001", "invoice_date": "2026-10-01", "due_date": "2026-10-31", "currency": "GBP", "subtotal": 90, "tax": 18, "total": 108, "line_items": [{ "description": "Printer toner", "quantity": 2, "unit_price": 45, "amount": 90 }], "confidence": "high", "notes": "" }'
    },
    position: [860, 520]
  }
});

const readInvoice = node({
  type: '@n8n/n8n-nodes-langchain.chainLlm',
  version: 1.9,
  config: {
    name: 'AI Read Invoice',
    parameters: {
      promptType: 'define',
      text: expr('Extract the invoice fields from the text below.\n\nRules:\n- Copy values exactly as they appear. Never guess or invent a value.\n- If a field is missing, use an empty string for text fields and 0 for numbers.\n- Dates in YYYY-MM-DD format.\n- currency as a 3-letter code (GBP, USD, EUR, AED, PKR). If unclear, empty string.\n- confidence: "high" if all main fields are clearly present, "medium" if some are unclear, "low" if the text does not look like an invoice.\n- notes: one short sentence about anything unclear, otherwise empty.\n\nInvoice text:\n{{ $json.text }}'),
      hasOutputParser: true
    },
    subnodes: { model: geminiModel, outputParser: invoiceParser },
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 3000,
    position: [720, 220]
  },
  output: [{ output: { vendor: 'Northwind Supplies Ltd', invoice_number: 'INV-1001', invoice_date: '2026-10-01', due_date: '2026-10-31', currency: 'GBP', subtotal: 90, tax: 18, total: 108, line_items: [{ description: 'Printer toner', quantity: 2, unit_price: 45, amount: 90 }], confidence: 'high', notes: '' } }]
});

const checkTotals = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Check Totals',
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: {
        assignments: [
          { id: 'f1', name: 'file_name', value: expr('{{ $("Upload Invoice").item.json.Invoice?.[0]?.filename ?? "invoice.pdf" }}'), type: 'string' },
          { id: 'f2', name: 'vendor', value: expr('{{ $json.output.vendor || "" }}'), type: 'string' },
          { id: 'f3', name: 'invoice_number', value: expr('{{ $json.output.invoice_number || "" }}'), type: 'string' },
          { id: 'f4', name: 'invoice_date', value: expr('{{ $json.output.invoice_date || "" }}'), type: 'string' },
          { id: 'f5', name: 'due_date', value: expr('{{ $json.output.due_date || "" }}'), type: 'string' },
          { id: 'f6', name: 'currency', value: expr('{{ $json.output.currency || "" }}'), type: 'string' },
          { id: 'f7', name: 'subtotal', value: expr('{{ Number($json.output.subtotal) || 0 }}'), type: 'number' },
          { id: 'f8', name: 'tax', value: expr('{{ Number($json.output.tax) || 0 }}'), type: 'number' },
          { id: 'f9', name: 'total', value: expr('{{ Number($json.output.total) || 0 }}'), type: 'number' },
          { id: 'f10', name: 'line_items', value: expr('{{ ($json.output.line_items || []).map(l => (l.quantity ?? 1) + " x " + l.description + " = " + l.amount).join("; ") }}'), type: 'string' },
          { id: 'f11', name: 'review_reason', value: expr('{{ [ !$json.output.invoice_number ? "No invoice number" : "", !Number($json.output.total) ? "No total found" : "", (Number($json.output.subtotal) && Math.abs(Number($json.output.subtotal) + (Number($json.output.tax) || 0) - Number($json.output.total)) > 0.05) ? "Subtotal + tax does not match total" : "", $json.output.confidence === "low" ? "Does not look like an invoice" : "", $json.output.notes || "" ].filter(Boolean).join("; ") }}'), type: 'string' },
          { id: 'f12', name: 'processed_at', value: expr('{{ $now.toISO() }}'), type: 'string' }
        ]
      }
    },
    position: [1000, 220]
  },
  output: [{ file_name: 'invoice-1001.pdf', vendor: 'Northwind Supplies Ltd', invoice_number: 'INV-1001', invoice_date: '2026-10-01', due_date: '2026-10-31', currency: 'GBP', subtotal: 90, tax: 18, total: 108, line_items: '2 x Printer toner = 90', review_reason: '', processed_at: '2026-10-13T10:00:00.000+05:00' }]
});

const saveInvoice = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Save Invoice Row',
    parameters: {
      resource: 'row',
      operation: 'insert',
      dataTableId: { __rl: true, mode: 'id', value: 'YOUR_DATA_TABLE_ID', cachedResultName: 'DEMO_invoices' },
      columns: {
        mappingMode: 'defineBelow',
        value: {
          file_name: expr('{{ $json.file_name }}'),
          vendor: expr('{{ $json.vendor }}'),
          invoice_number: expr('{{ $json.invoice_number }}'),
          invoice_date: expr('{{ $json.invoice_date }}'),
          due_date: expr('{{ $json.due_date }}'),
          currency: expr('{{ $json.currency }}'),
          subtotal: expr('{{ $json.subtotal }}'),
          tax: expr('{{ $json.tax }}'),
          total: expr('{{ $json.total }}'),
          line_items: expr('{{ $json.line_items }}'),
          needs_review: expr('{{ $json.review_reason !== "" }}'),
          review_reason: expr('{{ $json.review_reason }}'),
          processed_at: expr('{{ $json.processed_at }}')
        },
        schema: [
          { id: 'file_name', displayName: 'file_name', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'vendor', displayName: 'vendor', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'invoice_number', displayName: 'invoice_number', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'invoice_date', displayName: 'invoice_date', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'due_date', displayName: 'due_date', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'currency', displayName: 'currency', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'subtotal', displayName: 'subtotal', required: false, defaultMatch: false, display: true, type: 'number', canBeUsedToMatch: true },
          { id: 'tax', displayName: 'tax', required: false, defaultMatch: false, display: true, type: 'number', canBeUsedToMatch: true },
          { id: 'total', displayName: 'total', required: false, defaultMatch: false, display: true, type: 'number', canBeUsedToMatch: true },
          { id: 'line_items', displayName: 'line_items', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'needs_review', displayName: 'needs_review', required: false, defaultMatch: false, display: true, type: 'boolean', canBeUsedToMatch: true },
          { id: 'review_reason', displayName: 'review_reason', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'processed_at', displayName: 'processed_at', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }
        ]
      }
    },
    position: [1240, 220]
  },
  output: [{ id: 1, createdAt: '2026-10-13T05:00:00.000Z', updatedAt: '2026-10-13T05:00:00.000Z' }]
});

const showResult = node({
  type: 'n8n-nodes-base.form',
  version: 2.5,
  config: {
    name: 'Show Result',
    parameters: {
      operation: 'completion',
      respondWith: 'text',
      completionTitle: expr('{{ $("Check Totals").item.json.review_reason ? "Saved, needs a quick check" : "Invoice saved" }}'),
      completionMessage: expr('Vendor: {{ $("Check Totals").item.json.vendor || "-" }}\nInvoice: {{ $("Check Totals").item.json.invoice_number || "-" }} · {{ $("Check Totals").item.json.invoice_date || "-" }}\nTotal: {{ $("Check Totals").item.json.currency }} {{ $("Check Totals").item.json.total }} (tax {{ $("Check Totals").item.json.tax }})\nItems: {{ $("Check Totals").item.json.line_items || "-" }}\n{{ $("Check Totals").item.json.review_reason ? "Flagged: " + $("Check Totals").item.json.review_reason : "All checks passed." }}')
    },
    position: [1480, 220]
  }
});

const scannedNotice = node({
  type: 'n8n-nodes-base.form',
  version: 2.5,
  config: {
    name: 'Scanned PDF Notice',
    parameters: {
      operation: 'completion',
      respondWith: 'text',
      completionTitle: 'This PDF has no readable text',
      completionMessage: 'It looks like a scanned image. In a client setup, scanned files are sent to an OCR step or a person for review instead of being guessed.'
    },
    position: [720, 420]
  }
});

const note = sticky('## AI Invoice Reader\nForm upload → PDF text → Gemini extracts fields → totals checked → saved to the DEMO_invoices data table.\n\nRows with a missing number, missing total or totals that do not add up are saved with needs_review = true, never silently trusted.\n\nClient version: swap the form for a Gmail trigger (attachments) and the data table for Google Sheets or Xero.', [], { color: 4, position: [-40, -60], width: 520, height: 260 });

export default workflow('ai-invoice-reader', 'DEMO · AI Invoice Reader (PDF → Table)')
  .add(uploadForm)
  .to(extractPdf)
  .to(hasText
    .onTrue(readInvoice.to(checkTotals.to(saveInvoice.to(showResult))))
    .onFalse(scannedNotice))
  .add(note);
