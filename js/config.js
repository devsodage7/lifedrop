/* ============================================================
   LifeDrop+ — config
   Cloud block: Supabase project URL + anon (public) key.
   The anon key is safe in the browser: row level security
   protects every table. NEVER put the service_role key here.
   ============================================================ */

window.LIFEDROP_CONFIG = {
  brand: 'LifeDrop+',
  tagline: 'Smart blood donor finder & emergency response',
  countryCode: '91',
  cooldownDays: 90,

  cloud: {
    enabled: true,
    url: 'https://imgofcwjpfiyemhwazvd.supabase.co',
    anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImltZ29mY3dqcGZpeWVtaHdhenZkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM4NjE3NDAsImV4cCI6MjEwOTQzNzc0MH0.QTamNRVkefmW74ob-gTrGNunCDS2Mw9SedzB-k6NyyI',
  },
};
