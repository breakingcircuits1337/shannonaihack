
import { $ } from 'zx';
import chalk from 'chalk';
import { PentestError } from '../error-handling.js';
import path from 'path';
import fs from 'fs';
import net from 'net';

/**
 * Find an available port starting from the given port.
 */
async function findAvailablePort(startPort: number): Promise<number> {
  const isPortAvailable = (port: number): Promise<boolean> => {
    return new Promise((resolve) => {
      const server = net.createServer();
      server.once('error', () => resolve(false));
      server.once('listening', () => {
        server.close(() => resolve(true));
      });
      server.listen(port);
    });
  };

  let port = startPort;
  while (!(await isPortAvailable(port))) {
    port++;
    if (port > startPort + 100) {
       throw new Error(`Could not find an open port between ${startPort} and ${startPort + 100}`);
    }
  }
  return port;
}

/**
 * Poll the proxy health endpoint until it is ready or timeout occurs.
 */
async function waitForProxy(port: number, timeoutMs: number = 10000): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    try {
      await $`curl -s http://localhost:${port}/health`;
      return; // Success
    } catch (e) {
      // Wait 500ms before retry
      await new Promise(r => setTimeout(r, 500));
    }
  }

  throw new Error(`Timed out waiting for Antigravity proxy on port ${port}`);
}

export async function setupGeminiProxy(): Promise<void> {
  console.log(chalk.blue('🔮 Setting up Gemini 3.0 via Antigravity Proxy...'));

  const proxyBin = path.resolve('node_modules/.bin/antigravity-claude-proxy');

  if (!fs.existsSync(proxyBin)) {
      throw new PentestError(
          'antigravity-claude-proxy binary not found. Please run npm install.',
          'config',
          false
      );
  }

  // 1. Check if accounts are configured
  try {
    const accountsOutput = await $`${proxyBin} accounts list`;
    if (accountsOutput.stdout.includes('No accounts configured') || accountsOutput.stdout.trim() === '') {
       console.log(chalk.yellow('⚠️ No Google accounts configured for Antigravity Proxy.'));
       console.log(chalk.yellow('Please run the following command to authenticate:'));
       console.log(chalk.white.bold('   ./node_modules/.bin/antigravity-claude-proxy accounts add'));
       throw new PentestError(
           'Antigravity proxy not authenticated',
           'config',
           false
       );
    }
  } catch (error) {
     if (error instanceof PentestError) throw error;
     // If the command fails, it might be due to some other issue
     console.log(chalk.yellow('⚠️ Failed to check accounts. Assuming manual setup or continuing...'));
  }

  // 2. Find available port
  const port = await findAvailablePort(8080);
  console.log(chalk.gray(`    Using port ${port} for proxy`));

  // 3. Check if proxy is already running on that port (unlikely due to check, but maybe our own proxy)
  // Actually, findAvailablePort ensures it is NOT running.
  // But wait, if we ran Shannon before and left it running?
  // Ideally, we should check if *our* proxy is running.
  // But for now, we just start a new one on a free port.
  // If a previous instance is running on 8080, findAvailablePort will return 8081.

  console.log(chalk.blue(`🚀 Starting Antigravity proxy on port ${port}...`));

  // Start in background with dynamic port
  // We need to pass the port via environment variable PORT
  process.env.PORT = port.toString();

  const subprocess = $`PORT=${port} ${proxyBin} start`.nothrow().quiet();

  // Detach process
  if ((subprocess as any).child) {
      (subprocess as any).child.unref();
  } else {
      subprocess.catch(() => {});
  }

  // 4. Wait for healthy
  try {
    await waitForProxy(port);
    console.log(chalk.green(`✅ Antigravity proxy started and healthy on port ${port}.`));
  } catch (e) {
    console.log(chalk.red(`❌ Failed to start Antigravity proxy: ${(e as Error).message}`));
    throw new PentestError('Failed to start Gemini proxy', 'tool', true);
  }

  // 5. Set Environment Variable for the SDK
  process.env.ANTHROPIC_BASE_URL = `http://localhost:${port}`;
  process.env.SHANNON_MODEL_PROVIDER = 'gemini'; // Marker for executor

  console.log(chalk.cyan(`✨ Gemini 3.0 mode enabled. Requests routed to http://localhost:${port}`));
}
