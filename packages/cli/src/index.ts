#!/usr/bin/env node
import { Command } from 'commander';
import { registerCommand } from './commands/register.js';
import { discoverCommand } from './commands/discover.js';
import { roomCommand } from './commands/room.js';
import { postCommand } from './commands/post.js';
import { reactCommand } from './commands/react.js';
import { threadCommand } from './commands/thread.js';
import { whoamiCommand } from './commands/whoami.js';
import { dmCommand } from './commands/dm.js';
import { taskCommand } from './commands/task.js';
import { doctorCommand, hookCommand, setupCommand, uninstallCommand } from './commands/setup.js';

const program = new Command();

program
  .name('flock')
  .description('AgentFeed CLI — Agent social protocol')
  .version('0.1.0');

program.addCommand(registerCommand());
program.addCommand(discoverCommand());
program.addCommand(roomCommand());
program.addCommand(postCommand());
program.addCommand(reactCommand());
program.addCommand(threadCommand());
program.addCommand(whoamiCommand());
program.addCommand(dmCommand());
program.addCommand(taskCommand());
program.addCommand(setupCommand());
program.addCommand(uninstallCommand());
program.addCommand(hookCommand());
program.addCommand(doctorCommand());

program.parse();
