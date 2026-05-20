import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSessionCandidates,
  buildDeterministicGraph,
  compactObservationForGraph,
  loadExportData,
  scoreObservation,
  selectCandidates,
} from "./backfill-agentmemory-graph.mjs";

test("scoreObservation ranks concrete coding observations above lifecycle noise", () => {
  const edit = scoreObservation({
    id: "obs_edit",
    type: "file_edit",
    title: "Edit",
    narrative: "Updated packages/web/src/pages/RoomPage.tsx to fix provider graph rendering and timeout handling.",
    files: ["packages/web/src/pages/RoomPage.tsx"],
    concepts: ["graph extraction", "timeout"],
  });

  const stop = scoreObservation({
    id: "obs_stop",
    type: "other",
    title: "stop",
    narrative: "Session stopped.",
    files: [],
    concepts: [],
  });

  const postToolUse = scoreObservation({
    id: "obs_post_tool_use",
    type: "other",
    title: "post_tool_use",
    narrative: "{\"tool\":\"Read\",\"result\":\"ok\"}",
    files: [],
    concepts: [],
  });

  assert.ok(edit.score >= 160);
  assert.ok(edit.reasons.includes("files"));
  assert.ok(edit.reasons.includes("concepts"));
  assert.ok(stop.score < 40);
  assert.ok(postToolUse.score < 40);
});

test("selectCandidates skips covered observations and caps each session", () => {
  const exportData = {
    sessions: [
      { id: "sess_a", project: "/repo/a" },
      { id: "sess_b", project: "/repo/b" },
    ],
    observations: {
      sess_a: [
        {
          id: "covered",
          type: "file_edit",
          title: "Edit",
          narrative: "Changed packages/server/src/index.ts and updated Express routes.",
          files: ["packages/server/src/index.ts"],
          concepts: ["Express"],
        },
        {
          id: "a1",
          type: "error",
          title: "post_tool_failure",
          narrative: "Bash failed while running npm test for packages/server/src/index.ts.",
          files: ["packages/server/src/index.ts"],
          concepts: ["test failure"],
        },
        {
          id: "a2",
          type: "file_read",
          title: "Read",
          narrative: "Read packages/shared/src/types.ts to inspect shared room schema.",
          files: ["packages/shared/src/types.ts"],
          concepts: ["room schema"],
        },
      ],
      sess_b: [
        {
          id: "b1",
          type: "discovery",
          title: "Provider graph investigation",
          narrative: "Found graph/build 404 and graph/extract writes nodes through mem::graph-extract.",
          files: [],
          concepts: ["agentmemory", "knowledge graph"],
        },
      ],
    },
    graphNodes: [
      {
        id: "gn_1",
        sourceObservationIds: ["covered"],
      },
    ],
  };

  const result = selectCandidates(exportData, {
    limit: 10,
    minScore: 70,
    perSession: 1,
  });

  assert.deepEqual(
    result.candidates.map((candidate) => candidate.observation.id).sort(),
    ["a1", "b1"],
  );
  assert.equal(result.stats.coveredSkipped, 1);
  assert.equal(result.stats.sessionsConsidered, 2);
});

test("selectCandidates skips file edit observations when graph already has that file node", () => {
  const exportData = {
    sessions: [{ id: "sess_a", project: "/repo/a" }],
    observations: {
      sess_a: [
        {
          id: "same_file",
          type: "file_edit",
          title: "Edit",
          narrative: "Changed packages/server/src/index.ts to add Express middleware.",
          files: ["packages/server/src/index.ts"],
          concepts: [],
        },
        {
          id: "new_file",
          type: "file_edit",
          title: "Edit",
          narrative: "Changed packages/server/src/routes.ts to add room routes.",
          files: ["packages/server/src/routes.ts"],
          concepts: [],
        },
      ],
    },
    graphNodes: [
      {
        id: "gn_file",
        type: "file",
        name: "packages/server/src/index.ts",
        sourceObservationIds: ["other_obs"],
      },
    ],
  };

  const result = selectCandidates(exportData, {
    limit: 10,
    minScore: 70,
    perSession: 10,
  });

  assert.deepEqual(
    result.candidates.map((candidate) => candidate.observation.id),
    ["new_file"],
  );
  assert.equal(result.stats.fileCoveredSkipped, 1);
});

test("selectCandidates normalizes absolute file paths when checking covered file nodes", () => {
  const exportData = {
    sessions: [{ id: "sess_a", project: "/Users/xxx/Code/workSpace/Agent-Larked" }],
    observations: {
      sess_a: [
        {
          id: "same_absolute_file",
          type: "file_edit",
          title: "Edit",
          narrative: "Changed /Users/xxx/Code/workSpace/Agent-Larked/packages/server/src/index.ts.",
          files: ["/Users/xxx/Code/workSpace/Agent-Larked/packages/server/src/index.ts"],
          concepts: [],
        },
      ],
    },
    graphNodes: [
      {
        id: "gn_file",
        type: "file",
        name: "packages/server/src/index.ts",
        sourceObservationIds: ["other_obs"],
      },
    ],
  };

  const result = selectCandidates(exportData, {
    limit: 10,
    minScore: 70,
    perSession: 10,
  });

  assert.equal(result.candidates.length, 0);
  assert.equal(result.stats.fileCoveredSkipped, 1);
});

test("selectCandidates deduplicates repeated edits to the same file in a session", () => {
  const exportData = {
    sessions: [{ id: "sess_a", project: "/repo/a" }],
    observations: {
      sess_a: [
        {
          id: "edit_1",
          type: "file_edit",
          title: "Edit",
          narrative: "{\"file_path\":\"packages/server/src/index.ts\",\"old_string\":\"a\",\"new_string\":\"b\"}",
          files: ["packages/server/src/index.ts"],
          concepts: [],
        },
        {
          id: "edit_2",
          type: "file_edit",
          title: "Edit",
          narrative: "{\"file_path\":\"packages/server/src/index.ts\",\"old_string\":\"a\",\"new_string\":\"b\"}",
          files: ["packages/server/src/index.ts"],
          concepts: [],
        },
        {
          id: "edit_3",
          type: "file_edit",
          title: "Edit",
          narrative: "{\"file_path\":\"packages/server/src/routes.ts\",\"old_string\":\"a\",\"new_string\":\"b\"}",
          files: ["packages/server/src/routes.ts"],
          concepts: [],
        },
      ],
    },
    graphNodes: [],
  };

  const result = selectCandidates(exportData, {
    limit: 10,
    minScore: 70,
    perSession: 10,
  });

  assert.deepEqual(
    result.candidates.map((candidate) => candidate.observation.id),
    ["edit_1", "edit_3"],
  );
  assert.equal(result.stats.duplicateSkipped, 1);
});

test("compactObservationForGraph rewrites raw edit JSON into graph-friendly narrative", () => {
  const compact = compactObservationForGraph({
    observation: {
      id: "edit_json",
      type: "file_edit",
      title: "Edit",
      narrative: JSON.stringify({
        file_path: "/repo/packages/server/src/index.ts",
        old_string: "import express from 'express';\nconst app = express();",
        new_string: "import express from 'express';\nimport { createRoomRouter } from './routes/rooms.js';\nconst app = express();",
      }),
      files: ["/repo/packages/server/src/index.ts"],
      concepts: ["Express", "rooms"],
    },
    score: 200,
    reasons: ["files"],
  });

  assert.equal(compact.id, "edit_json");
  assert.equal(compact.type, "file_edit");
  assert.equal(compact.title, "Edit");
  assert.match(compact.narrative, /Edited file: \/repo\/packages\/server\/src\/index\.ts/);
  assert.match(compact.narrative, /Added or changed content/);
  assert.match(compact.narrative, /createRoomRouter/);
  assert.deepEqual(compact.files, ["/repo/packages/server/src/index.ts"]);
  assert.deepEqual(compact.concepts, ["Express", "rooms"]);
});

test("compactObservationForGraph extracts useful fields from truncated edit JSON", () => {
  const compact = compactObservationForGraph({
    observation: {
      id: "truncated_edit_json",
      type: "file_edit",
      title: "Edit",
      narrative: "{\"replace_all\":false,\"file_path\":\"/repo/packages/web/src/RoomPage.tsx\",\"old_string\":\"import React from 'react';\\n\",\"new_string\":\"import React from 'react';\\nimport { RoomTimeline } from './RoomTimeline';",
      files: ["/repo/packages/web/src/RoomPage.tsx"],
      concepts: [],
    },
    score: 200,
    reasons: ["files"],
  });

  assert.match(compact.narrative, /Edited file: \/repo\/packages\/web\/src\/RoomPage\.tsx/);
  assert.match(compact.narrative, /RoomTimeline/);
  assert.doesNotMatch(compact.narrative, /^\{/);
});

test("buildSessionCandidates creates graph-friendly aggregate observations", () => {
  const exportData = {
    sessions: [
      {
        id: "sess_a",
        project: "Agent-Larked",
        cwd: "/repo/Agent-Larked",
        firstPrompt: "Add room task API",
      },
    ],
    observations: {
      sess_a: [
        {
          id: "edit_room",
          type: "file_edit",
          title: "Edit",
          narrative: JSON.stringify({
            file_path: "/repo/Agent-Larked/packages/server/src/routes/rooms.ts",
            old_string: "import { Router } from 'express';",
            new_string: "import { Router } from 'express';\nimport { createRoom } from '../services/room.js';",
          }),
          files: ["/repo/Agent-Larked/packages/server/src/routes/rooms.ts"],
          concepts: ["Express", "rooms"],
        },
        {
          id: "failure",
          type: "error",
          title: "post_tool_failure",
          narrative: "npm test failed in packages/server/src/routes/rooms.ts because createRoom was not exported.",
          files: ["packages/server/src/routes/rooms.ts"],
          concepts: ["test failure"],
        },
      ],
    },
    graphNodes: [],
  };

  const result = buildSessionCandidates(exportData, {
    limit: 10,
    perSession: 5,
    minScore: 70,
  });

  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].id, "session_graph_sess_a");
  assert.match(result.candidates[0].narrative, /Project: Agent-Larked/);
  assert.match(result.candidates[0].narrative, /packages\/server\/src\/routes\/rooms\.ts/);
  assert.match(result.candidates[0].narrative, /Express/);
  assert.match(result.candidates[0].narrative, /npm test failed/);
  assert.deepEqual(result.candidates[0].sourceObservationIds.sort(), ["edit_room", "failure"]);
});

test("buildDeterministicGraph creates file, concept, and library graph items", () => {
  const sessions = [
    {
      id: "session_graph_sess_a",
      sessionId: "sess_a",
      title: "Session graph summary: Agent-Larked",
      narrative: "Project: Agent-Larked\nKey files: packages/server/src/routes/rooms.ts\nConcepts: Express, rooms\nImportant observations:\n- [file_edit / Edit] import { Router } from 'express'; import { createRoom } from '../services/room.js';",
      files: ["packages/server/src/routes/rooms.ts"],
      concepts: ["Express", "rooms"],
      sourceObservationIds: ["edit_room", "failure"],
    },
  ];

  const graph = buildDeterministicGraph(sessions, {
    existingGraphNodes: [],
    existingGraphEdges: [],
  });

  assert.ok(graph.graphNodes.some((node) => node.type === "file" && node.name === "packages/server/src/routes/rooms.ts"));
  assert.ok(graph.graphNodes.some((node) => node.type === "library" && node.name === "Express"));
  assert.ok(graph.graphNodes.some((node) => node.type === "concept" && node.name === "rooms"));
  assert.ok(graph.graphEdges.some((edge) => edge.type === "related_to"));
  assert.ok(graph.graphEdges.some((edge) => edge.type === "uses"));
});

test("loadExportData falls back to sessions, observations, and graph query when export fails", async () => {
  const calls = [];
  const fetcher = async (url, options = {}) => {
    calls.push({ url, options });
    if (url === "http://viewer/agentmemory/export") {
      return {
        ok: false,
        status: 500,
        text: async () => JSON.stringify({ error: "Invocation stopped" }),
      };
    }
    if (url === "http://rest/agentmemory/sessions") {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          sessions: [
            { id: "sess_a", project: "Agent-Larked" },
            { id: "sess_b", project: "computer-use" },
          ],
        }),
      };
    }
    if (url === "http://rest/agentmemory/observations?sessionId=sess_a") {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          observations: [
            {
              id: "obs_a",
              type: "file_edit",
              title: "Edit",
              narrative: "Changed packages/server/src/index.ts",
              files: ["packages/server/src/index.ts"],
            },
          ],
        }),
      };
    }
    if (url === "http://rest/agentmemory/observations?sessionId=sess_b") {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ observations: [] }),
      };
    }
    if (url === "http://rest/agentmemory/graph/query") {
      assert.equal(options.method, "POST");
      assert.equal(options.headers.Authorization, "Bearer test-secret");
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          nodes: [{ id: "gn_file", type: "file", name: "packages/server/src/index.ts" }],
          edges: [{ id: "ge_1", type: "related_to", sourceNodeId: "gn_project", targetNodeId: "gn_file" }],
        }),
      };
    }
    throw new Error(`Unexpected URL ${url}`);
  };

  const exportData = await loadExportData({
    viewerUrl: "http://viewer",
    restUrl: "http://rest",
    secret: "test-secret",
    fetcher,
  });

  assert.equal(exportData.sessions.length, 2);
  assert.equal(exportData.observations.sess_a.length, 1);
  assert.equal(exportData.observations.sess_b.length, 0);
  assert.equal(exportData.graphNodes.length, 1);
  assert.equal(exportData.graphEdges.length, 1);
  assert.match(exportData.exportWarning, /Fallback export used/);
  assert.ok(calls.some((call) => call.url === "http://viewer/agentmemory/export"));
  assert.ok(calls.some((call) => call.url === "http://rest/agentmemory/sessions"));
});

test("loadExportData can read fallback data through viewer when direct REST routing fails", async () => {
  const fetcher = async (url, options = {}) => {
    if (url === "http://viewer/agentmemory/export") {
      return {
        ok: false,
        status: 500,
        text: async () => JSON.stringify({ error: "Invocation stopped" }),
      };
    }
    if (url === "http://rest/agentmemory/sessions") {
      return {
        ok: false,
        status: 500,
        text: async () => JSON.stringify({ error: "Function api::sessions not found" }),
      };
    }
    if (url === "http://viewer/agentmemory/sessions") {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ sessions: [{ id: "sess_viewer", project: "viewer" }] }),
      };
    }
    if (url === "http://viewer/agentmemory/observations?sessionId=sess_viewer") {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ observations: [] }),
      };
    }
    if (url === "http://viewer/agentmemory/graph/query") {
      assert.equal(options.method, "POST");
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ nodes: [], edges: [] }),
      };
    }
    throw new Error(`Unexpected URL ${url}`);
  };

  const exportData = await loadExportData({
    viewerUrl: "http://viewer",
    restUrl: "http://rest",
    secret: "test-secret",
    fetcher,
  });

  assert.deepEqual(exportData.sessions.map((session) => session.id), ["sess_viewer"]);
  assert.deepEqual(Object.keys(exportData.observations), ["sess_viewer"]);
});

test("loadExportData retries transient fallback route misses", async () => {
  let sessionAttempts = 0;
  const fetcher = async (url) => {
    if (url === "http://viewer/agentmemory/export") {
      return {
        ok: false,
        status: 500,
        text: async () => JSON.stringify({ error: "Invocation stopped" }),
      };
    }
    if (url === "http://rest/agentmemory/sessions") {
      sessionAttempts += 1;
      if (sessionAttempts === 1) {
        return {
          ok: false,
          status: 500,
          text: async () => JSON.stringify({ error: "Function api::sessions not found" }),
        };
      }
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ sessions: [{ id: "sess_retry", project: "retry" }] }),
      };
    }
    if (url === "http://rest/agentmemory/observations?sessionId=sess_retry") {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ observations: [] }),
      };
    }
    if (url === "http://rest/agentmemory/graph/query") {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ nodes: [], edges: [] }),
      };
    }
    throw new Error(`Unexpected URL ${url}`);
  };

  const exportData = await loadExportData({
    viewerUrl: "http://viewer",
    restUrl: "http://rest",
    secret: "test-secret",
    fetcher,
  });

  assert.equal(sessionAttempts, 2);
  assert.deepEqual(exportData.sessions.map((session) => session.id), ["sess_retry"]);
});

test("loadExportData paces fallback observation reads", async () => {
  const sleeps = [];
  const fetcher = async (url) => {
    if (url === "http://viewer/agentmemory/export") {
      return {
        ok: false,
        status: 500,
        text: async () => JSON.stringify({ error: "Invocation stopped" }),
      };
    }
    if (url === "http://rest/agentmemory/sessions") {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          sessions: [
            { id: "sess_a", project: "a" },
            { id: "sess_b", project: "b" },
          ],
        }),
      };
    }
    if (url === "http://rest/agentmemory/observations?sessionId=sess_a" || url === "http://rest/agentmemory/observations?sessionId=sess_b") {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ observations: [] }),
      };
    }
    if (url === "http://rest/agentmemory/graph/query") {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ nodes: [], edges: [] }),
      };
    }
    throw new Error(`Unexpected URL ${url}`);
  };

  await loadExportData({
    viewerUrl: "http://viewer",
    restUrl: "http://rest",
    secret: "test-secret",
    fetcher,
    fallbackReadDelayMs: 25,
    sleeper: async (ms) => sleeps.push(ms),
  });

  assert.deepEqual(sleeps, [25]);
});
