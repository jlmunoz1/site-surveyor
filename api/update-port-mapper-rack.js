// Vercel serverless function. Renames an existing rack in Port Mapper's
// Supabase project — used when the person edits the "Rack / site ID"
// field on a device that already has an auto-created rack, so the
// rack's actual name in Port Mapper stays in sync with what they typed.
// Same service_role key pattern as the other Port Mapper functions.
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

  const { rackId, name } = req.body || {}
  if (!rackId) {
    res.status(400).json({ error: 'rackId is required' })
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
      .update({ name: name.trim() })
      .eq('id', rackId)
      .select()
      .single()

    if (error) {
      res.status(500).json({ error: error.message })
      return
    }
    res.status(200).json({ rack: data })
  } catch (err) {
    res.status(500).json({ error: err.message || 'Unknown error renaming rack in Port Mapper' })
  }
}
