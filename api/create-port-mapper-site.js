// Vercel serverless function. Creates a matching "site" row in Port
// Mapper's Supabase project whenever a project is created in Site
// Surveyor. Uses Port Mapper's service_role key, which is only ever
// read here server-side from an environment variable — it is never
// sent to or exposed in the browser.
const { createClient } = require('@supabase/supabase-js')

const PORT_MAPPER_URL = 'https://ghatqfpujezxvlcepdgl.supabase.co'

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const serviceKey = process.env.PORT_MAPPER_SERVICE_ROLE_KEY
  if (!serviceKey) {
    res.status(500).json({ error: 'Server is missing PORT_MAPPER_SERVICE_ROLE_KEY' })
    return
  }

  const { name, location } = req.body || {}
  if (!name || typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ error: 'A site name is required' })
    return
  }

  try {
    const portMapper = createClient(PORT_MAPPER_URL, serviceKey)
    const { data, error } = await portMapper
      .from('sites')
      .insert({ name: name.trim(), location: location || null })
      .select()
      .single()

    if (error) {
      res.status(500).json({ error: error.message })
      return
    }
    res.status(200).json({ site: data })
  } catch (err) {
    res.status(500).json({ error: err.message || 'Unknown error creating site in Port Mapper' })
  }
}
