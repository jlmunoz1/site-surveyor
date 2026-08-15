// Vercel serverless function. Creates a rack in Port Mapper's Supabase
// project, tied to a given site_id. Uses the same service_role key as
// create-port-mapper-site.js — read only server-side, never exposed to
// the browser.
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

  const { siteId, name, uSize, rackType } = req.body || {}
  if (!siteId) {
    res.status(400).json({ error: 'siteId is required' })
    return
  }
  if (!name || typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ error: 'A rack name is required' })
    return
  }

  try {
    const portMapper = createClient(PORT_MAPPER_URL, serviceKey)
    const { data, error } = await portMapper
      .from('racks')
      .insert({
        site_id: siteId,
        name: name.trim(),
        u_size: uSize || 6,
        rack_type: rackType || 'Wall-Mount',
      })
      .select()
      .single()

    if (error) {
      res.status(500).json({ error: error.message })
      return
    }
    res.status(200).json({ rack: data })
  } catch (err) {
    res.status(500).json({ error: err.message || 'Unknown error creating rack in Port Mapper' })
  }
}
