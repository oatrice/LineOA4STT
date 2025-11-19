import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { initializeWorkerServices, runWorker } from '../../../src/workerCore.ts'

console.log('Transcription worker function starting up...')

serve(async (req) => {
  try {
    // 1. Get required environment variables
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
    const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')
    const LINE_CHANNEL_ACCESS_TOKEN = Deno.env.get('LINE_CHANNEL_ACCESS_TOKEN')

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !LINE_CHANNEL_ACCESS_TOKEN) {
      throw new Error('Missing required environment variables for the worker.')
    }

    // 2. Initialize services
    const services = initializeWorkerServices(
      SUPABASE_URL,
      SUPABASE_ANON_KEY,
      LINE_CHANNEL_ACCESS_TOKEN
    )

    // 3. Run the worker logic
    const result = await runWorker(services)

    // 4. Return the result
    return new Response(JSON.stringify(result), {
      status: result.status,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('Unhandled error in Supabase Edge Function:', error)
    return new Response(
      JSON.stringify({
        message: `Edge function failed: ${error.message}`,
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  }
})
