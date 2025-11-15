import 'dotenv/config'; // Load environment variables
import initializeApp from './index' // Import the default export

async function main() {
  const appHandle = await initializeApp(); // Call initializeApp to get the app.handle

  // สร้าง HTTP server สำหรับรันบน Bun
  const port = 3000;

  const server = Bun.serve({
    port,
    fetch: appHandle, // ใช้ appHandle สำหรับ Bun server
  });

  console.log(`🚀 Elysia server is running at http://localhost:${port}`);
  console.log(`📝 Webhook endpoint: http://localhost:${port}/webhook`);
  console.log(`🏠 Health check: http://localhost:${port}`);
}

main().catch(error => {
  console.error('❌ Application failed to start:', error);
  process.exit(1);
});
