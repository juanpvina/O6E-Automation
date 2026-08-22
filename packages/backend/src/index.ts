import { createServer } from './server';

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;

async function bootstrap() {
  try {
    const { app, scheduler, executor } = await createServer();
    const server = app.listen(PORT, '127.0.0.1', () => {
      console.log(`OpenCode Orchestrator Server running locally at http://127.0.0.1:${PORT}`);
      if (process.env.ORCHESTRATOR_API_TOKEN) {
        console.log('API authentication: ENABLED (ORCHESTRATOR_API_TOKEN is set).');
      } else {
        console.log('API authentication: DISABLED (ORCHESTRATOR_API_TOKEN not set, API is open).');
      }
    });

    // Recover executions left queued/running from a previous process run (Fase 1, A4).
    executor.recoverStaleExecutions().catch((err) => {
      console.error('Failed to recover stale executions:', err);
    });

    const shutdown = (signal: string) => {
      console.log(`Received ${signal}. Starting graceful shutdown...`);
      
      // Stop all cron jobs in the scheduler
      scheduler.stop();
      console.log('Scheduler stopped.');

      // Close the express server listener
      server.close((err) => {
        if (err) {
          console.error('Error closing express server:', err);
          process.exit(1);
        }
        console.log('Express server closed.');
        process.exit(0);
      });

      // Force shutdown after 10s if connections don't close
      setTimeout(() => {
        console.error('Forced shutdown: Could not close connections in time.');
        process.exit(1);
      }, 10000).unref();
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

bootstrap();
