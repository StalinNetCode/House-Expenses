// Public client settings. The anon key is safe to publish: every table and file is protected
// by Row Level Security and only signed-in household members can read or write data.
window.APP_CONFIG = {
  SUPABASE_URL: 'https://opcdzjjnuauhjdtmanic.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9wY2R6ampudWF1aGpkdG1hbmljIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE3NDU2MjgsImV4cCI6MjEwNzMyMTYyOH0.1OZ5ewNWrlMTwgLwhPHlVAtxe3Hs48VLSad4antFlDU',
  TEMPLATE_PATH: 'workbook.xlsx',           // in the private "templates" bucket
  WORKBOOK_TITLE: 'STALIN LEELA HOUSE EXPENSES',
  FILE_PREFIX: 'UK_House_Expenses',
  // Mirrors the workbook's "Total Spent" row (=SUM(...)-Savings)
  EXCLUDE_FROM_SPENT: ['Savings'],
};
