import { Command } from 'commander';
import {
  AgentFeedClient,
  createTask,
  listTasks,
  getTask,
  appendTaskEvent,
  addTaskArtifact,
} from '@flock/sdk';
import type { TaskStatus, TaskPriority, ArtifactType } from '@flock/sdk';
import { loadServer, loadToken } from '../config.js';

export function taskCommand(): Command {
  const cmd = new Command('task')
    .description('Task management');

  // flock task create
  cmd
    .command('create')
    .description('Create a new task in a room')
    .requiredOption('--room <id>', 'Room ID')
    .requiredOption('--title <title>', 'Task title')
    .option('--description <desc>', 'Task description')
    .option('--assignees <ids...>', 'Agent IDs to assign')
    .option('--origin-message <id>', 'Source message ID')
    .option('--priority <priority>', 'Priority (low/normal/high/urgent)', 'normal')
    .option('--server <url>', 'Server URL')
    .action(async (opts) => {
      const server = opts.server ?? loadServer();
      const token = loadToken();
      const client = new AgentFeedClient({ baseUrl: server, token });

      const validPriorities: TaskPriority[] = ['low', 'normal', 'high', 'urgent'];
      if (!validPriorities.includes(opts.priority as TaskPriority)) {
        console.error(`Invalid priority: ${opts.priority}. Must be one of: ${validPriorities.join(', ')}`);
        process.exit(1);
      }

      try {
        const result = await createTask(client, {
          room_id: opts.room,
          title: opts.title,
          description: opts.description,
          assignees: opts.assignees,
          origin_message_id: opts.originMessage,
          priority: opts.priority as TaskPriority,
          idempotency_key: crypto.randomUUID(),
        });
        console.log(`Task created: ${result.id}`);
        console.log(`  Title:    ${result.title}`);
        console.log(`  Status:   ${result.status}`);
        console.log(`  Priority: ${result.priority}`);
        if (result.assigned_to) {
          console.log(`  Assigned: ${result.assigned_to}`);
        }
      } catch (err) {
        console.error(`Failed: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  // flock task list
  cmd
    .command('list')
    .description('List tasks')
    .option('--room <id>', 'Filter by room ID')
    .option('--status <status>', 'Filter by status')
    .option('--assignee <id>', 'Filter by assignee')
    .option('--creator <id>', 'Filter by creator')
    .option('--limit <n>', 'Max results', '20')
    .option('--cursor <cursor>', 'Pagination cursor')
    .option('--server <url>', 'Server URL')
    .action(async (opts) => {
      const server = opts.server ?? loadServer();
      const token = loadToken();
      const client = new AgentFeedClient({ baseUrl: server, token });

      try {
        const result = await listTasks(client, {
          room_id: opts.room,
          status: opts.status as TaskStatus | undefined,
          assignee_id: opts.assignee,
          created_by: opts.creator,
          limit: Number(opts.limit),
          cursor: opts.cursor,
        });

        if (result.tasks.length === 0) {
          console.log('No tasks found.');
          return;
        }

        for (const task of result.tasks) {
          console.log(`[${task.status}] ${task.id.slice(0, 8)}  ${task.title}  (priority: ${task.priority})`);
        }
        if (result.has_more) {
          console.log(`\nMore results available. Use --cursor ${result.next_cursor}`);
        }
      } catch (err) {
        console.error(`Failed: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  // flock task get
  cmd
    .command('get')
    .description('Get task details')
    .argument('<task-id>', 'Task ID')
    .option('--server <url>', 'Server URL')
    .action(async (taskId: string, opts) => {
      const server = opts.server ?? loadServer();
      const token = loadToken();
      const client = new AgentFeedClient({ baseUrl: server, token });

      try {
        const result = await getTask(client, taskId);
        const { task, assignees, events, artifacts } = result;

        console.log(`Task: ${task.title}`);
        console.log(`  ID:        ${task.id}`);
        console.log(`  Room:      ${task.room_id}`);
        console.log(`  Status:    ${task.status}`);
        console.log(`  Priority:  ${task.priority}`);
        console.log(`  Created:   ${task.created_at}`);
        if (task.description) {
          console.log(`  Description: ${task.description}`);
        }
        if (assignees.length > 0) {
          console.log(`  Assignees: ${assignees.join(', ')}`);
        }

        if (events.length > 0) {
          console.log(`\nEvents (${events.length}):`);
          for (const evt of events) {
            const statusPart = evt.type === 'status_changed'
              ? ` [${evt.from_status} → ${evt.to_status}]`
              : '';
            const bodyPart = evt.body ? `: ${evt.body}` : '';
            console.log(`  [${evt.type}]${statusPart}${bodyPart}  (${evt.created_at})`);
          }
        }

        if (artifacts.length > 0) {
          console.log(`\nArtifacts (${artifacts.length}):`);
          for (const art of artifacts) {
            console.log(`  [${art.type}] ${art.name}  (${art.id})`);
          }
        }
      } catch (err) {
        console.error(`Failed: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  // flock task update
  cmd
    .command('update')
    .description('Add an event to a task (comment or status change)')
    .argument('<task-id>', 'Task ID')
    .option('--status <status>', 'New status')
    .option('--body <body>', 'Comment or note')
    .option('--server <url>', 'Server URL')
    .action(async (taskId: string, opts) => {
      const server = opts.server ?? loadServer();
      const token = loadToken();
      const client = new AgentFeedClient({ baseUrl: server, token });

      if (!opts.status && !opts.body) {
        console.error('Must provide at least --status or --body');
        process.exit(1);
      }

      try {
        const result = await appendTaskEvent(client, taskId, {
          status: opts.status as TaskStatus | undefined,
          body: opts.body,
          idempotency_key: crypto.randomUUID(),
        });
        console.log(`Event added: ${result.id}`);
        if (result.type === 'status_changed') {
          console.log(`  Status: ${result.from_status} → ${result.to_status}`);
        }
      } catch (err) {
        console.error(`Failed: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  // flock task artifact
  cmd
    .command('artifact')
    .description('Add an artifact to a task')
    .argument('<task-id>', 'Task ID')
    .requiredOption('--type <type>', 'Artifact type (text/json/code/uri)')
    .requiredOption('--name <name>', 'Artifact name')
    .option('--content <content>', 'Inline content (for text/json/code)')
    .option('--uri <uri>', 'URI (for uri type)')
    .option('--mime-type <mime>', 'MIME type')
    .option('--server <url>', 'Server URL')
    .action(async (taskId: string, opts) => {
      const server = opts.server ?? loadServer();
      const token = loadToken();
      const client = new AgentFeedClient({ baseUrl: server, token });

      const validTypes: ArtifactType[] = ['text', 'json', 'code', 'uri'];
      if (!validTypes.includes(opts.type as ArtifactType)) {
        console.error(`Invalid artifact type: ${opts.type}. Must be one of: ${validTypes.join(', ')}`);
        process.exit(1);
      }

      try {
        const result = await addTaskArtifact(client, taskId, {
          type: opts.type as ArtifactType,
          name: opts.name,
          content: opts.content,
          uri: opts.uri,
          mime_type: opts.mimeType,
          idempotency_key: crypto.randomUUID(),
        });
        console.log(`Artifact added: ${result.id}`);
        console.log(`  Type: ${result.type}`);
        console.log(`  Name: ${result.name}`);
      } catch (err) {
        console.error(`Failed: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  return cmd;
}
