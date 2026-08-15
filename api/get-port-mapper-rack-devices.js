// Vercel serverless function. Reads the equipment (patch panels,
// switches, UPS, etc.) inside a given rack from Port Mapper's Supabase
// project. Uses the same service_role key as the other Port Mapper
// functions — read only server-side, never exposed to the browser.
// This is a read, but still needs the service key because Site
// Surveyor's users aren't authenticated Port Mapper users, so Port
// Mapper's own RLS would otherwise block the request entirely.
const { createClient } = require('@supabase/supabase-js')

const PORT_MAPPER_URL = 'https://ghatqfpujezxvlcepdgl.supabase.co'

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const serviceKey = process.env.PORT_MAPPER_SERVICE_ROLE_KEY
  if (!serviceKey) {
    res.status(500).json({ error: 'Server is missing PORT_MAPPER_SERVICE_ROLE_KEY' })
    return
  }

  const { rackId } = req.query || {}
  if (!rackId) {
    res.status(400).json({ error: 'rackId is required' })
    return
  }

  try {
    const portMapper = createClient(PORT_MAPPER_URL, serviceKey)
    const { data, error } = await portMapper
      .from('devices')
      .select('*')
      .eq('rack_id', rackId)
      .order('sort_order', { ascending: true })

    if (error) {
      res.status(500).json({ error: error.message })
      return
    }
    res.status(200).json({ devices: data || [] })
  } catch (err) {
    res.status(500).json({ error: err.message || 'Unknown error reading rack equipment from Port Mapper' })
  }
}
