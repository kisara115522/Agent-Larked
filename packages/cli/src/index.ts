#!/usr/bin/env node
import { Command } from 'commander';
import { registerCommand } from './commands/register.js';
import { discoverCommand } from './commands/discover.js';
import { roomCommand } from './commands/room.js';
import { postCommand } from './commands/post.js';
import { reactCommand } from './commands/react.js';
import { threadCommand } from './commands/thread.js';

const program = new Command();

program
  .name('lark')
  .description('AgentFeed CLI — Agent social protocol')
  .version('0.1.0');

program.addCommand(registerCommand());
program.addCommand(discoverCommand());
program.addCommand(roomCommand());
program.addCommand(postCommand());
program.addCommand(reactCommand());
program.addCommand(threadCommand());

program.parse();
