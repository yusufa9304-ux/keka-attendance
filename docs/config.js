/* Where the app talks to.
 *
 * Both values are meant to be public. The publishable key is not a password —
 * it only says "this is the Vutto Attendance app". What actually protects the
 * data is row level security inside the database: every table has a policy that
 * decides which rows the signed-in person may see, so shipping this key to the
 * browser gives nobody access to anything they should not have.
 *
 * The keys that must stay secret — the Telegram bot token, the service role key
 * — are never here. They live inside Supabase, on the server side.
 */
window.VUTTO = {
  supabaseUrl: 'https://sxxlkrzdxfpylwmduttz.supabase.co',
  supabaseKey: 'sb_publishable_iIHZK6MyML-EUDzWeyDCEA_vcKsd73z',
  brand: '#E4002B',
  pingMinutes: 10,
};
