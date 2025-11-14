import { createAppWithEnv } from './index'

// ฟังก์ชันสำหรับอ่าน Secret File
async function readSecretFile(filename: string): Promise<string | undefined> {
  const filePath = `/etc/secrets/${filename}`;
  try {
    const file = Bun.file(filePath);
    if (await file.exists()) {
      console.log(`✅ Reading secret from ${filePath}`);
      return await file.text();
    }
  } catch (error) {
    console.warn(`⚠️ Could not read secret file ${filePath}:`, error);
  }
  return undefined;
}

async function main() {
  // อ่าน environment variables จาก process.env หรือจาก Secret Files
  const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET || await readSecretFile('LINE_CHANNEL_SECRET');
  const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN || await readSecretFile('LINE_CHANNEL_ACCESS_TOKEN');
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
  const NODE_ENV = process.env.NODE_ENV;

  // ตรวจสอบว่า environment variables ที่จำเป็นมีค่าหรือไม่
  if (!LINE_CHANNEL_SECRET) {
    throw new Error('LINE_CHANNEL_SECRET is not defined.');
  }
  if (!LINE_CHANNEL_ACCESS_TOKEN) {
    throw new Error('LINE_CHANNEL_ACCESS_TOKEN is not defined.');
  }
  if (!SUPABASE_URL) {
    throw new Error('SUPABASE_URL is not defined.');
  }
  if (!SUPABASE_ANON_KEY) {
    throw new Error('SUPABASE_ANON_KEY is not defined.');
  }

  // สร้าง app instance โดยใช้ factory function และส่ง environment variables เข้าไป
  const app = createAppWithEnv({
    LINE_CHANNEL_SECRET,
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    LINE_CHANNEL_ACCESS_TOKEN,
    NODE_ENV,
  });

  // สร้าง HTTP server สำหรับรันบน Bun
  const port = 3000;

  const server = Bun.serve({
    port,
    fetch: app.handle, // ใช้ app.handle สำหรับ Bun server
  });

  console.log(`🚀 Elysia server is running at http://localhost:${port}`);
  console.log(`📝 Webhook endpoint: http://localhost:${port}/webhook`);
  console.log(`🏠 Health check: http://localhost:${port}`);
}

main().catch(error => {
  console.error('❌ Application failed to start:', error);
  process.exit(1);
});
