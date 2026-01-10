
import { $ } from 'zx';
import chalk from 'chalk';
import { PentestError } from '../error-handling.js';
import path from 'path';
import fs from 'fs';

export async function setupGeminiProxy(): Promise<void> {
  console.log(chalk.blue('🔮 Setting up Gemini 3.0 via Antigravity Proxy...'));

  const proxyBin = path.resolve('node_modules/.bin/antigravity-claude-proxy');

  if (!fs.existsSync(proxyBin)) {
      // Fallback for when looking in the wrong place, though it should be there if npm installed
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

  // 2. Check if proxy is already running (simple check on port 8080)
  // We can use lsof or curl.
  try {
      await $`curl -s http://localhost:8080/health`;
      console.log(chalk.green('✅ Antigravity proxy is already running.'));
  } catch (e) {
      console.log(chalk.blue('🚀 Starting Antigravity proxy...'));
      // Start in background
      const subprocess = $`${proxyBin} start`.nothrow().quiet();
      // Detach process
      if ((subprocess as any).child) {
          (subprocess as any).child.unref();
      } else {
          // Fallback if type differs, though likely not needed for runtime if zx works
          subprocess.catch(() => {});
      }

      // Wait a bit for it to start
      await new Promise(r => setTimeout(r, 3000));
      console.log(chalk.green('✅ Antigravity proxy started.'));
  }

  // 3. Set Environment Variable for the SDK
  process.env.ANTHROPIC_BASE_URL = 'http://localhost:8080';
  process.env.SHANNON_MODEL_PROVIDER = 'gemini'; // Marker for executor

  console.log(chalk.cyan('✨ Gemini 3.0 mode enabled. Requests will be routed through Antigravity.'));
}
