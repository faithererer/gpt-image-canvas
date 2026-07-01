import http from "node:http";
import {
  DEEPAGENT_PLANNING_MEMORY_PATH,
  agentModelKwargsForConfig,
  buildPlannerUserMessage,
  createGenerationPlan,
  createPlanningMemoryFiles,
  extractReasoningFromAgentResult,
  parseGenerationPlanModelOutput,
  patchDeepSeekReasoningContentForRequest,
  type AgentPlannerResult,
  validateGenerationPlan
} from "../domain/agent/planner.js";
import {
  CANVAS_IMAGE_PLANNING_SKILL_PATH,
  ECOMMERCE_VISUAL_COPYWRITING_COMPLIANCE_RULES_PATH,
  ECOMMERCE_VISUAL_COPYWRITING_SKILL_PATH,
  createCorePlanningSkill,
  type PlanningSkillLoadout
} from "../domain/agent/planning-skill.js";
import type { UsableAgentLlmConfig } from "../domain/agent/config.js";
import type {
  AgentSelectedCanvasReference,
  GenerationPlan,
  GenerationPlanDefaults,
  GenerationPlanValidationResult
} from "../domain/contracts.js";

const now = new Date("2026-01-01T00:00:00.000Z");
const defaults: GenerationPlanDefaults = {
  size: {
    width: 1024,
    height: 1024
  },
  quality: "auto",
  outputFormat: "png",
  count: 1
};
const selectedReferences: AgentSelectedCanvasReference[] = [
  {
    id: "shape-ref-1",
    assetId: "asset-ref-1",
    label: "Selected product image",
    width: 1024,
    height: 1024,
    mimeType: "image/png",
    dataUrl: "data:image/png;base64,AAAA"
  }
];
const creativeReferenceUserText =
  "\u57fa\u4e8e\u4e0a\u4f20\u56fe\u7247\u751f\u62103\u5f20\u513f\u7ae5\u827a\u672f\u5199\u771f\uff0c\u4e0d\u62d8\u6ce5\u4e8e\u52a8\u4f5c\u548c\u59ff\u52bf\uff0c\u53ef\u7231\u98ce\u548c\u5947\u5e7b\u98ce\u3002";

async function main(): Promise<void> {
  smokeValidSimplePlan();
  smokeMultiPromptPlan();
  smokeSelectedReferencePlan();
  smokeSelectedReferenceAliasPlan();
  smokeSelectedReferenceKindAliases();
  smokeInferredReferenceKinds();
  smokeAmbiguousSelectedReferenceFallback();
  smokeHallucinatedSelectedReferenceWithoutSelection();
  smokeGeneratedAnchorDependencyPlan();
  smokeOverLimitPlanRejection();
  smokeCyclePlanRejection();
  smokeInvalidJsonRejection();
  smokeNoVisionReferenceHandling();
  smokeCreativeReferencePlannerMessage();
  smokePlannerConversationContextPrompt();
  await smokePlannerInjectsDeepAgentMemory();
  smokeDeepSeekPlannerKwargs();
  await smokeDeepSeekReasoningContentRoundTripThroughDeepAgent();
  smokeReasoningExtraction();
  await smokeDefaultPlannerReceivesBuiltInSkillLibrary();
  await smokeEcommerceRequestLoadsEcommerceSkill();
  await smokeDisabledEcommerceSkillIsNotInjected();
  await smokeCustomLoadoutSkillIsInjected();
  await smokePlannerQuestionOutput();
  await smokeMissingSelectedReferenceQuestion();
  await smokeStandaloneTextImageWithImageCopyDoesNotRequireReference();
  await smokeStandalonePromptQuestionReflectsToPlan();
  await smokeSelectedEditPlanWithoutReferenceQuestion();
  await smokeSelectedQuestionOutputFallbackPlan();
  await smokePerImageSelectedReferencePlan();
  await smokeBatchSelectedReferenceFallbackUsesAllReferences();
  await smokeSelectedVariantFallbackPreservesExplicitCount();
  await smokeCreativeReferenceFallbackAvoidsDirectEditLanguage();
  await smokeCreativeReferenceUsageOtherCanonicalized();
  await smokePlannerReflectsOnDroppedExplicitCount();
  await smokeSingleCombinedSelectedReferenceLimitQuestion();
  await smokeRecentOutputEditWithoutReferencesStillAsks();
  await smokeCombinedSelectedReferencePlan();
  await smokePlannerReflectsOnWrappedOutput();
  await smokePlannerReflectsOnInvalidPlan();
  smokeModelJobSizeCoercion();
  smokeModelArbitraryFinalJobCount();
  smokeModelArbitraryDefaultCount();
  smokeModelArbitraryDependentTargetCount();
  smokeModelUnsupportedSourceJobCountRejection();
  smokeModelOptionalOutputAliases();
  smokeModelReferenceAliases();
  smokeModelJobRoleAliases();

  console.log("agent planner smoke checks passed");
}

function smokeValidSimplePlan(): void {
  const result = validate(planFixture(), []);
  expectOk(result, "valid simple plan");
  expect(result.plan.jobs.length === 1, "simple plan has one job");
  expect(result.plan.jobs[0]?.count === 1, "simple plan count is one");
}

function smokeMultiPromptPlan(): void {
  const result = validate(
    planFixture({
      jobs: [
        jobFixture({ id: "hero_square", prompt: "Create a square hero product render.", count: 2 }),
        jobFixture({ id: "detail_square", prompt: "Create a close-up detail render.", count: 2 })
      ]
    }),
    []
  );
  expectOk(result, "multi-prompt plan");
  expect(result.plan.jobs.length === 2, "multi-prompt plan has two jobs");
}

function smokeSelectedReferencePlan(): void {
  const result = validate(
    planFixture({
      jobs: [
        jobFixture({
          references: [
            {
              kind: "selected_canvas_image",
              usage: "product",
              assetId: "asset-ref-1"
            }
          ]
        })
      ]
    }),
    selectedReferences
  );
  expectOk(result, "selected-reference plan");
  expect(result.plan.jobs[0]?.references[0]?.assetId === "asset-ref-1", "selected reference is preserved");
}

function smokeSelectedReferenceAliasPlan(): void {
  const result = validate(
    planFixture({
      jobs: [
        jobFixture({
          references: [
            {
              kind: "selected_canvas_image",
              usage: "product",
              assetId: "ref1"
            }
          ]
        })
      ]
    }),
    selectedReferences
  );
  expectOk(result, "selected-reference alias plan");
  expect(result.plan.jobs[0]?.references[0]?.assetId === "asset-ref-1", "ref1 alias is normalized to selected assetId");
  expect(result.plan.jobs[0]?.references[0]?.label === "Selected product image", "selected reference label is preserved");
}

function smokeSelectedReferenceKindAliases(): void {
  const result = validate(
    planFixture({
      jobs: [
        jobFixture({
          references: [
            {
              kind: "selected canvas image",
              usage: "product",
              assetId: "ref1"
            }
          ]
        })
      ]
    }),
    selectedReferences
  );
  expectOk(result, "selected-reference kind aliases are accepted");
  expect(result.plan.jobs[0]?.references[0]?.kind === "selected_canvas_image", "selected reference kind alias is normalized");
  expect(result.plan.jobs[0]?.references[0]?.assetId === "asset-ref-1", "selected reference alias still resolves assetId");
}

function smokeInferredReferenceKinds(): void {
  const result = validate(
    planFixture({
      jobs: [
        jobFixture({
          id: "style_anchor",
          role: "style_anchor",
          prompt: "Create one visible picture book style anchor.",
          count: 1
        }),
        jobFixture({
          id: "selected_ref_scene",
          references: [
            {
              usage: "product",
              assetId: "ref1"
            }
          ]
        }),
        jobFixture({
          id: "generated_ref_scene",
          references: [
            {
              usage: "style",
              sourceJobId: "style_anchor"
            }
          ]
        })
      ],
      edges: [
        {
          from: "style_anchor",
          to: "generated_ref_scene"
        }
      ]
    }),
    selectedReferences
  );

  expectOk(result, "missing reference kind is inferred from fields");
  expect(result.plan.jobs[1]?.references[0]?.kind === "selected_canvas_image", "assetId-only reference infers selected_canvas_image");
  expect(result.plan.jobs[2]?.references[0]?.kind === "generated_output", "sourceJobId-only reference infers generated_output");
}

function smokeAmbiguousSelectedReferenceFallback(): void {
  const references: AgentSelectedCanvasReference[] = [
    ...selectedReferences,
    {
      id: "shape-ref-2",
      assetId: "asset-ref-2",
      label: "Second canvas image"
    }
  ];
  const result = validate(
    planFixture({
      jobs: [
        jobFixture({
          references: [
            {
              kind: "selected_canvas_image",
              usage: "style",
              assetId: "ref1 and ref2"
            }
          ]
        })
      ]
    }),
    references
  );
  expectOk(result, "ambiguous selected-reference alias falls back instead of rejecting");
  expect(result.plan.jobs[0]?.references[0]?.assetId === "asset-ref-1", "ambiguous alias falls back to the first selected asset");
}

function smokeHallucinatedSelectedReferenceWithoutSelection(): void {
  const result = validate(
    planFixture({
      jobs: [
        jobFixture({
          references: [
            {
              kind: "selected_canvas_image",
              usage: "product",
              assetId: "selected_canvas_image"
            }
          ]
        })
      ]
    }),
    []
  );
  expectOk(result, "hallucinated selected reference is ignored when no canvas references are selected");
  expect(result.plan.jobs[0]?.references.length === 0, "unavailable selected reference is removed");
}

function smokeGeneratedAnchorDependencyPlan(): void {
  const result = validate(
    planFixture({
      jobs: [
        jobFixture({
          id: "character_anchor",
          role: "character_anchor",
          prompt: "Create one visible character anchor for a young explorer.",
          count: 1
        }),
        jobFixture({
          id: "story_scene",
          prompt: "Create two story scenes using the character anchor.",
          count: 2,
          references: [
            {
              kind: "generated_output",
              usage: "character",
              jobId: "character_anchor"
            }
          ]
        })
      ],
      edges: [
        {
          fromJobId: "character_anchor",
          toJobId: "story_scene"
        }
      ]
    }),
    []
  );
  expectOk(result, "generated-anchor dependency plan");
  expect(result.plan.edges.length === 1, "anchor plan has dependency edge");
}

function smokeOverLimitPlanRejection(): void {
  const result = validate(
    planFixture({
      jobs: [
        jobFixture({ id: "batch_a", count: 16 }),
        jobFixture({ id: "batch_b", count: 1 })
      ]
    }),
    []
  );
  expect(!result.ok, "over-limit plan is rejected");
  expect(result.code === "generation_plan_limit_exceeded", "over-limit rejection code is stable");
}

function smokeCyclePlanRejection(): void {
  const result = validate(
    planFixture({
      jobs: [
        jobFixture({
          id: "source_a",
          references: [
            {
              kind: "generated_output",
              usage: "style",
              jobId: "source_b"
            }
          ]
        }),
        jobFixture({
          id: "source_b",
          references: [
            {
              kind: "generated_output",
              usage: "style",
              jobId: "source_a"
            }
          ]
        })
      ],
      edges: [
        {
          fromJobId: "source_a",
          toJobId: "source_b"
        },
        {
          fromJobId: "source_b",
          toJobId: "source_a"
        }
      ]
    }),
    []
  );
  expect(!result.ok, "cycle plan is rejected");
  expect(result.code === "generation_dependency_cycle", "cycle rejection code is stable");
}

function smokeInvalidJsonRejection(): void {
  const result = parseGenerationPlanModelOutput("Here is the plan: {}", {
    defaults,
    selectedReferences: [],
    now
  });
  expect(!result.ok, "non-JSON model output is rejected");
  expect(result.code === "invalid_plan_json", "non-JSON rejection code is stable");
}

function smokeNoVisionReferenceHandling(): void {
  const message = buildPlannerUserMessage({
    userText: "Use my selected image as a product reference.",
    defaults,
    selectedReferences,
    supportsVision: false
  });

  expect(typeof message.content === "string", "no-vision planner message is text-only");
  expect(!message.content.includes("data:image"), "no-vision planner message does not include image data");
  expect(message.content.includes("Do not claim visual inspection"), "no-vision message includes inspection warning");
}

function smokeCreativeReferencePlannerMessage(): void {
  const message = buildPlannerUserMessage({
    userText: creativeReferenceUserText,
    defaults,
    selectedReferences,
    supportsVision: false
  });
  const content = typeof message.content === "string" ? message.content : "";

  expect(content.includes("Selected-image creative reference mode"), "creative reference requests get reference guidance");
  expect(content.includes("create a new image"), "creative reference guidance asks for a new image");
  expect(content.includes('usage "subject"'), "creative reference guidance requires subject usage for identity references");
  expect(
    !content.includes("Prompts must say to edit the original directly"),
    "creative reference guidance avoids direct edit instructions"
  );
}

function smokePlannerConversationContextPrompt(): void {
  const message = buildPlannerUserMessage({
    userText: "Make image 3 text bigger.",
    defaults,
    selectedReferences: [
      {
        id: "previous-agent-output-3",
        assetId: "asset-output-3",
        label: "dish-3.png",
        width: 1024,
        height: 1024,
        mimeType: "image/png"
      }
    ],
    supportsVision: false,
    conversationContext: {
      previousUserText: "Generate 10 Guangdong food images.",
      previousPlan: planFixture({
        id: "plan-food",
        title: "Guangdong food batch"
      }) as unknown as GenerationPlan,
      previousOutputs: [
        {
          index: 1,
          assetId: "asset-output-1",
          label: "dish-1.png"
        },
        {
          index: 3,
          assetId: "asset-output-3",
          label: "dish-3.png"
        }
      ],
      resolvedReferences: [
        {
          index: 3,
          assetId: "asset-output-3",
          label: "dish-3.png"
        }
      ],
      referenceResolution: "previous_agent_outputs"
    }
  });
  const content =
    typeof message.content === "string"
      ? message.content
      : String(message.content.find((block) => block.type === "text")?.text ?? "");

  expect(content.includes("Current Agent conversation context"), "planner prompt includes conversation context heading");
  expect(content.includes("Previous user request: Generate 10 Guangdong food images."), "planner prompt includes previous user request");
  expect(content.includes("output3: assetId=\"asset-output-3\""), "planner prompt includes resolved output index");
  expect(content.includes("Resolved follow-up image references from previous Agent outputs"), "planner prompt explains resolved references");

  const clarificationMessage = buildPlannerUserMessage({
    userText: "新的设计图",
    defaults,
    selectedReferences: [],
    supportsVision: false,
    conversationContext: {
      previousUserText: "在原图上加一行标题。"
    }
  });
  const clarificationContent =
    typeof clarificationMessage.content === "string"
      ? clarificationMessage.content
      : String(clarificationMessage.content.find((block) => block.type === "text")?.text ?? "");
  expect(clarificationContent.includes("Previous user request: 在原图上加一行标题。"), "clarification prompt keeps previous request");
  expect(
    clarificationContent.includes("Create a new standalone design image for the previous request"),
    "clarification prompt explains new-design intent"
  );
}

async function smokePlannerInjectsDeepAgentMemory(): Promise<void> {
  const conversationContext = {
    previousUserText: "Generate 10 Guangdong food images.",
    previousPlan: planFixture({
      id: "plan-food",
      title: "Guangdong food batch"
    }) as unknown as GenerationPlan,
    previousOutputs: [
      {
        index: 3,
        assetId: "asset-output-3",
        label: "dish-3.png"
      }
    ],
    resolvedReferences: [
      {
        index: 3,
        assetId: "asset-output-3",
        label: "dish-3.png"
      }
    ],
    referenceResolution: "previous_agent_outputs" as const
  };
  const memoryFiles = createPlanningMemoryFiles(now, {
    userText: "Make image 3 text bigger.",
    conversationContext
  });
  expect(DEEPAGENT_PLANNING_MEMORY_PATH in memoryFiles, "DeepAgent memory file is created");
  const directMemoryText = fileDataText(memoryFiles[DEEPAGENT_PLANNING_MEMORY_PATH]);
  expect(directMemoryText.includes("Current Agent conversation context"), "DeepAgent memory includes context heading");
  expect(directMemoryText.includes("asset-output-3"), "DeepAgent memory includes resolved output reference");

  const runner = capturingPlannerRunner(planFixture());
  const result = await createGenerationPlan({
    userText: "Make image 3 text bigger.",
    defaults,
    selectedReferences: [],
    conversationContext,
    llmConfig: llmConfigFixture(),
    now,
    runner
  });
  expectPlannerOk(result, "planner with DeepAgent memory injection");
  const files = runner.calls[0]?.files;
  expect(isRecord(files), "planner runner receives virtual files");
  expect(DEEPAGENT_PLANNING_MEMORY_PATH in files, "planner runner receives DeepAgent memory file");
  expect(
    fileDataText(files[DEEPAGENT_PLANNING_MEMORY_PATH]).includes("Previous user request: Generate 10 Guangdong food images."),
    "planner DeepAgent memory preserves previous user text"
  );
}

function smokeDeepSeekPlannerKwargs(): void {
  const kwargs = agentModelKwargsForConfig({
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-v4-pro"
  });

  expect(isRecord(kwargs.thinking), "DeepSeek planner enables thinking with top-level OpenAI-compatible body param");
  expect(kwargs.thinking.type === "enabled", "DeepSeek planner enables thinking");
  expect(kwargs.reasoning_effort === "high", "DeepSeek planner sets high reasoning effort");

  const maxKwargs = agentModelKwargsForConfig(
    {
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-v4-pro"
    },
    {
      thinking: { type: "enabled" },
      reasoningEffort: "max"
    }
  );
  expect(
    isRecord(maxKwargs.thinking) &&
      maxKwargs.thinking.type === "enabled",
    "DeepSeek planner keeps thinking enabled"
  );
  expect(maxKwargs.reasoning_effort === "max", "DeepSeek planner accepts max reasoning effort");

  const disabledKwargs = agentModelKwargsForConfig(
    {
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-v4-pro"
    },
    {
      thinking: { type: "disabled" },
      reasoningEffort: "max"
    }
  );
  expect(
    isRecord(disabledKwargs.thinking) &&
      disabledKwargs.thinking.type === "disabled",
    "DeepSeek planner can disable thinking"
  );
  expect(!("reasoning_effort" in disabledKwargs), "disabled thinking omits reasoning effort");

  const reasoningByToolCallId = new Map<string, string>();
  const patchedRequest = patchDeepSeekReasoningContentForRequest(
    {
      messages: [
        {
          role: "assistant",
          content: "",
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: {
                name: "read_file",
                arguments: "{}"
              }
            }
          ]
        },
        {
          role: "tool",
          tool_call_id: "call_1",
          content: "tool result"
        }
      ]
    },
    [
      {
        additional_kwargs: {
          reasoning_content: "I need to inspect the skill file before planning."
        }
      },
      {}
    ],
    reasoningByToolCallId
  );
  const patchedMessages = patchedRequest.messages;
  expect(
    Array.isArray(patchedMessages) &&
      isRecord(patchedMessages[0]) &&
      patchedMessages[0].reasoning_content === "I need to inspect the skill file before planning.",
    "DeepAgent loop preserves DeepSeek reasoning_content for tool-call turns"
  );
  const replayedRequest = patchDeepSeekReasoningContentForRequest(
    {
      messages: [
        {
          role: "assistant",
          content: "",
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: {
                name: "read_file",
                arguments: "{}"
              }
            }
          ]
        }
      ]
    },
    [{}],
    reasoningByToolCallId
  );
  const replayedMessages = replayedRequest.messages;
  expect(
    Array.isArray(replayedMessages) &&
      isRecord(replayedMessages[0]) &&
      replayedMessages[0].reasoning_content === "I need to inspect the skill file before planning.",
    "DeepAgent loop replays DeepSeek reasoning_content on later requests by tool call id"
  );

  const openAIKwargs = agentModelKwargsForConfig({
    model: "gpt-4.1-mini"
  });
  expect(Object.keys(openAIKwargs).length === 0, "OpenAI planner kwargs are unchanged");
}

async function smokeDeepSeekReasoningContentRoundTripThroughDeepAgent(): Promise<void> {
  const requests: Array<Record<string, unknown>> = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      const body = (raw ? JSON.parse(raw) : {}) as Record<string, unknown>;
      requests.push(body);
      const missingReasoning = requestAssistantToolMessages(body).find(
        (message) => typeof message.reasoning_content !== "string" || message.reasoning_content.length === 0
      );
      if (requests.length > 1 && missingReasoning) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: "missing reasoning_content in fake DeepSeek" } }));
        return;
      }

      if (requests.length === 1) {
        writeFakeDeepSeekStream(res, [
          fakeDeepSeekChunk({
            role: "assistant",
            reasoning_content: "Need to create todos before final planning.",
            tool_calls: [
              {
                index: 0,
                id: "call_todos",
                type: "function",
                function: {
                  name: "write_todos",
                  arguments: JSON.stringify({
                    todos: [{ content: "Draft image plan", status: "in_progress" }]
                  })
                }
              }
            ]
          }),
          fakeDeepSeekChunk({}, "tool_calls")
        ]);
        return;
      }

      writeFakeDeepSeekStream(res, [
        fakeDeepSeekChunk({
          role: "assistant",
          content: JSON.stringify(planFixture())
        }),
        fakeDeepSeekChunk({}, "stop")
      ]);
    });
  });

  try {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const result = await createGenerationPlan({
      userText: "Create one image.",
      defaults,
      selectedReferences: [],
      llmConfig: {
        apiKey: "test-key",
        baseUrl: `http://127.0.0.1:${port}/v1`,
        model: "deepseek-v4-pro",
        timeoutMs: 10_000,
        supportsVision: false
      },
      now
    });

    expectPlannerOk(result, "DeepSeek reasoning_content round trip through DeepAgent");
    expect(isRecord(requests[0]?.thinking), "DeepAgent sends DeepSeek thinking as a top-level request body field");
    expect(
      requestAssistantToolMessages(requests[1]).some(
        (message) => message.reasoning_content === "Need to create todos before final planning."
      ),
      "DeepAgent returns reasoning_content after tool-call turns"
    );
  } finally {
    server.close();
  }
}

function requestAssistantToolMessages(request: Record<string, unknown> | undefined): Array<Record<string, unknown>> {
  const messages = request?.messages;
  if (!Array.isArray(messages)) {
    return [];
  }

  return messages.filter(
    (message): message is Record<string, unknown> =>
      isRecord(message) && message.role === "assistant" && Array.isArray(message.tool_calls)
  );
}

function writeFakeDeepSeekStream(res: http.ServerResponse, chunks: Array<Record<string, unknown>>): void {
  res.writeHead(200, { "content-type": "text/event-stream" });
  for (const chunk of chunks) {
    res.write(`data: ${JSON.stringify(chunk)}\n\n`);
  }
  res.write("data: [DONE]\n\n");
  res.end();
}

function fakeDeepSeekChunk(delta: Record<string, unknown>, finishReason: string | null = null): Record<string, unknown> {
  return {
    id: "chatcmpl-smoke",
    object: "chat.completion.chunk",
    created: 0,
    model: "deepseek-v4-pro",
    choices: [
      {
        index: 0,
        delta,
        finish_reason: finishReason
      }
    ]
  };
}

function smokeReasoningExtraction(): void {
  const reasoning = extractReasoningFromAgentResult({
    messages: [
      {
        content: "ordinary assistant text",
        additional_kwargs: {
          reasoning_content: "I should split the request into four scenes."
        }
      }
    ]
  });

  expect(reasoning === "I should split the request into four scenes.", "reasoning content is extracted");
}

async function smokeDefaultPlannerReceivesBuiltInSkillLibrary(): Promise<void> {
  const runner = capturingPlannerRunner(planFixture());
  const result = await createGenerationPlan({
    userText: "Create a clean product photography render.",
    defaults,
    selectedReferences,
    llmConfig: llmConfigFixture(),
    now,
    runner
  });

  expectPlannerOk(result, "default planner skill library request");
  const files = runner.calls[0]?.files;
  expect(isRecord(files), "default planner receives skill files");
  expect(CANVAS_IMAGE_PLANNING_SKILL_PATH in files, "default planner receives canvas skill");
  expect(ECOMMERCE_VISUAL_COPYWRITING_SKILL_PATH in files, "default planner exposes ecommerce skill for model-side matching");
  expect(
    ECOMMERCE_VISUAL_COPYWRITING_COMPLIANCE_RULES_PATH in files,
    "default planner exposes ecommerce compliance rules for model-side matching"
  );
}

async function smokeEcommerceRequestLoadsEcommerceSkill(): Promise<void> {
  const runner = capturingPlannerRunner(planFixture());
  const result = await createGenerationPlan({
    userText: "Create marketplace listing copy for this SKU.",
    defaults,
    selectedReferences: [],
    llmConfig: llmConfigFixture(),
    now,
    runner
  });

  expectPlannerOk(result, "ecommerce planner request");
  const files = runner.calls[0]?.files;
  expect(isRecord(files), "ecommerce planner receives skill files");
  expect(CANVAS_IMAGE_PLANNING_SKILL_PATH in files, "ecommerce planner receives canvas skill");
  expect(ECOMMERCE_VISUAL_COPYWRITING_SKILL_PATH in files, "ecommerce planner receives ecommerce skill");
  expect(
    ECOMMERCE_VISUAL_COPYWRITING_COMPLIANCE_RULES_PATH in files,
    "ecommerce planner receives ecommerce compliance rules"
  );
}

async function smokeDisabledEcommerceSkillIsNotInjected(): Promise<void> {
  const runner = capturingPlannerRunner(planFixture());
  const result = await createGenerationPlan({
    userText: "Create marketplace listing copy for this SKU.",
    defaults,
    selectedReferences: [],
    llmConfig: llmConfigFixture(),
    now,
    runner,
    skillLoadout: {
      skills: [createCorePlanningSkill()]
    }
  });

  expectPlannerOk(result, "disabled ecommerce planner request");
  const files = runner.calls[0]?.files;
  expect(isRecord(files), "disabled ecommerce planner receives skill files");
  expect(CANVAS_IMAGE_PLANNING_SKILL_PATH in files, "disabled ecommerce planner still receives canvas skill");
  expect(
    !(ECOMMERCE_VISUAL_COPYWRITING_SKILL_PATH in files),
    "disabled ecommerce planner does not receive ecommerce skill"
  );
}

async function smokeCustomLoadoutSkillIsInjected(): Promise<void> {
  const runner = capturingPlannerRunner(planFixture());
  const skillLoadout: PlanningSkillLoadout = {
    skills: [
      createCorePlanningSkill(),
      {
        slug: "brand-voice",
        name: "brand-voice",
        version: "brand-voice@1",
        required: false,
        triggerMode: "auto",
        files: [
          {
            path: "/skills/brand-voice/SKILL.md",
            content: "---\nname: brand-voice\ndescription: Keep copy plain.\n---\n# Brand Voice\nUse plain, concrete copy."
          }
        ]
      }
    ]
  };
  const result = await createGenerationPlan({
    userText: "Use our brand-voice keyword and make a product image.",
    defaults,
    selectedReferences: [],
    llmConfig: llmConfigFixture(),
    now,
    runner,
    skillLoadout
  });

  expectPlannerOk(result, "custom skill planner request");
  const files = runner.calls[0]?.files;
  expect(isRecord(files), "custom skill planner receives skill files");
  expect("/skills/brand-voice/SKILL.md" in files, "custom loadout skill is injected");
}

async function smokePlannerQuestionOutput(): Promise<void> {
  const result = await createGenerationPlan({
    userText: "在原图上加一行标题。",
    defaults,
    selectedReferences: [],
    llmConfig: llmConfigFixture(),
    now,
    runner: staticPlannerRunner({
      kind: "agent_user_question",
      code: "missing_selected_canvas_reference",
      message: "Select the original image first.",
      createdBy: "agent"
    })
  });

  expect(!result.ok, "planner accepts skill question output");
  expect(result.code === "missing_selected_canvas_reference", "skill question keeps stable missing-reference code");
}

async function smokeMissingSelectedReferenceQuestion(): Promise<void> {
  const result = await createGenerationPlan({
    userText: "在原图上加一行标题。",
    defaults,
    selectedReferences: [],
    llmConfig: llmConfigFixture(),
    now,
    runner: staticPlannerRunner(planFixture())
  });

  expect(!result.ok, "missing selected reference edit request asks for user input");
  expect(result.code === "missing_selected_canvas_reference", "missing selected reference uses stable code");
}

async function smokeStandaloneTextImageWithImageCopyDoesNotRequireReference(): Promise<void> {
  const result = await createGenerationPlan({
    userText: "生成一张新品海报，图上加标题和卖点文案。",
    defaults,
    selectedReferences: [],
    llmConfig: llmConfigFixture(),
    now,
    runner: staticPlannerRunner(
      planFixture({
        jobs: [
          jobFixture({
            id: "standalone_poster",
            prompt: "Create a standalone product poster with a headline and selling-point copy.",
            references: []
          })
        ]
      })
    )
  });

  expectPlannerOk(result, "standalone text-to-image prompt with image copy does not require a reference");
  expect(result.plan.jobs[0]?.references.length === 0, "standalone image-copy plan keeps zero references");
}

async function smokeStandalonePromptQuestionReflectsToPlan(): Promise<void> {
  const runner = sequencedPlannerRunner([
    {
      kind: "agent_user_question",
      code: "missing_selected_canvas_reference",
      message: "Select the original image first.",
      createdBy: "agent"
    },
    planFixture({
      jobs: [
        jobFixture({
          id: "standalone_poster_after_reflection",
          prompt: "Create a standalone product poster with a headline and selling-point copy.",
          references: []
        })
      ]
    })
  ]);
  const result = await createGenerationPlan({
    userText: "生成一张新品海报，图上加标题和卖点文案。",
    defaults,
    selectedReferences: [],
    llmConfig: llmConfigFixture(),
    now,
    runner
  });

  expectPlannerOk(result, "standalone prompt question output is corrected after reflection");
  expect(runner.calls.length === 2, "standalone prompt missing-reference question triggers one reflection");
}

async function smokeSelectedEditPlanWithoutReferenceQuestion(): Promise<void> {
  const result = await createGenerationPlan({
    userText: "给每张图配上文字，更有设计感。",
    defaults,
    selectedReferences: selectedReferencesTwo(),
    llmConfig: llmConfigFixture(),
    now,
    runner: staticPlannerRunner(
      planFixture({
        jobs: [jobFixture({ id: "blank_template", prompt: "Create a clean geometric template with typography." })]
      })
    )
  });

  expectPlannerOk(result, "selected-image edit plan without references falls back to selected-reference jobs");
  expect(result.plan.jobs.length === 2, "fallback creates one job per selected image");
  expect(result.plan.jobs[0]?.references[0]?.assetId === "asset-ref-1", "fallback first job references first selected image");
  expect(result.plan.jobs[1]?.references[0]?.assetId === "asset-ref-2", "fallback second job references second selected image");
}

async function smokeSelectedQuestionOutputFallbackPlan(): Promise<void> {
  const result = await createGenerationPlan({
    userText: "给每张图配上文字，更有设计感。",
    defaults,
    selectedReferences: selectedReferencesTwo(),
    llmConfig: llmConfigFixture(),
    now,
    runner: staticPlannerRunner({
      kind: "agent_user_question",
      code: "agent_requires_user_input",
      message: "Should I edit selected originals or create new images?",
      createdBy: "agent"
    })
  });

  expectPlannerOk(result, "selected-image edit question output falls back to plan");
  expect(result.plan.jobs.length === 2, "question fallback creates one job per selected image");
  expect(result.plan.jobs.every((job) => job.references.length === 1), "question fallback keeps one selected reference per job");
}

async function smokePerImageSelectedReferencePlan(): Promise<void> {
  const result = await createGenerationPlan({
    userText: "给每张图配上文字，更有设计感。",
    defaults,
    selectedReferences: selectedReferencesTwo(),
    llmConfig: llmConfigFixture(),
    now,
    runner: staticPlannerRunner(
      planFixture({
        jobs: [
          jobFixture({
            id: "caption_ref_1",
            prompt: "Edit the original selected image directly, preserve the scene, and add refined Chinese title typography.",
            references: [
              {
                kind: "selected_canvas_image",
                usage: "scene",
                assetId: "ref1"
              }
            ]
          }),
          jobFixture({
            id: "caption_ref_2",
            prompt: "Edit the original selected image directly, preserve the scene, and add refined Chinese title typography.",
            references: [
              {
                kind: "selected_canvas_image",
                usage: "scene",
                assetId: "ref2"
              }
            ]
          })
        ]
      })
    )
  });

  expectPlannerOk(result, "per-image selected-reference plan");
  expect(result.plan.jobs.length === 2, "per-image selected edit preserves model-created job split");
  expect(result.plan.jobs[0]?.references[0]?.assetId === "asset-ref-1", "ref1 is normalized");
  expect(result.plan.jobs[1]?.references[0]?.assetId === "asset-ref-2", "ref2 is normalized");
}

async function smokeBatchSelectedReferenceFallbackUsesAllReferences(): Promise<void> {
  const references = selectedReferencesMany(10);
  const result = await createGenerationPlan({
    userText: "让所有图里面的文案字体统一。",
    defaults,
    selectedReferences: references,
    llmConfig: llmConfigFixture(),
    now,
    runner: staticPlannerRunner({
      kind: "agent_user_question",
      code: "agent_requires_user_input",
      message: "Should I edit selected originals or create new images?",
      createdBy: "agent"
    })
  });

  expectPlannerOk(result, "batch selected-reference fallback uses all references");
  expect(result.plan.jobs.length === references.length, "batch fallback creates one job per selected image");
  expect(result.plan.jobs.every((job) => job.count === 1), "batch fallback keeps each edit job count at one");
  expect(result.plan.jobs.every((job) => job.references.length === 1), "batch fallback keeps one selected reference per job");
  expect(result.plan.jobs[9]?.references[0]?.assetId === "asset-ref-10", "batch fallback includes the tenth selected image");
}

async function smokeSelectedVariantFallbackPreservesExplicitCount(): Promise<void> {
  const references = selectedReferencesMany(3);
  const result = await createGenerationPlan({
    userText:
      "\u53c2\u8003\u5982\u4e0b\u63d0\u793a\u8bcd\uff0c\u751f\u62105\u5f20\u4e0d\u540c\u7684\u63d0\u793a\u8bcd\u7684\u56fe\u7247\uff1a collage-style design with layered typography.",
    defaults,
    selectedReferences: references,
    llmConfig: llmConfigFixture(),
    now,
    runner: staticPlannerRunner({
      kind: "agent_user_question",
      code: "agent_requires_user_input",
      message: "Should I edit selected originals or create new images?",
      createdBy: "agent"
    })
  });

  expectPlannerOk(result, "selected variant fallback preserves explicit output count");
  expect(result.plan.jobs.length === 5, "selected variant fallback creates five variant jobs");
  expect(result.plan.jobs.every((job) => job.count === 1), "selected variant fallback keeps one output per variant job");
  expect(
    result.plan.jobs.every((job) => job.references.length === references.length),
    "selected variant fallback reuses the selected reference set for every variant"
  );
  expect(
    result.plan.jobs.every((job) => job.references.every((reference) => reference.kind === "selected_canvas_image")),
    "selected variant fallback uses selected_canvas_image references"
  );
}

async function smokeCreativeReferenceFallbackAvoidsDirectEditLanguage(): Promise<void> {
  const result = await createGenerationPlan({
    userText: creativeReferenceUserText,
    defaults,
    selectedReferences,
    llmConfig: llmConfigFixture(),
    now,
    runner: staticPlannerRunner(
      planFixture({
        jobs: [
          jobFixture({
            id: "overly_literal_edit",
            prompt:
              "Edit the original image into a fantasy portrait while preserving the child pose, composition, and original scene.",
            count: 3,
            references: [
              {
                kind: "selected_canvas_image",
                usage: "scene",
                assetId: "ref1"
              }
            ]
          })
        ]
      })
    )
  });

  expectPlannerOk(result, "creative reference fallback avoids direct edit language");
  expect(result.plan.jobs.length === 3, "creative reference fallback creates three distinct jobs");
  expect(
    result.plan.jobs.every((job) => job.references[0]?.usage === "subject"),
    "creative reference fallback marks selected references as subject references"
  );
  expect(
    result.plan.jobs.every(
      (job) =>
        !/edit the original image|preserve the original image content|preserv(?:e|ing) (?:the )?(?:original )?(?:pose|composition|scene)/iu.test(
          job.prompt
        )
    ),
    "creative reference fallback prompts avoid direct-edit preservation wording"
  );
  expect(
    result.plan.jobs.every((job) => /new image|variant/iu.test(job.prompt)),
    "creative reference fallback prompts ask for new images"
  );
}

async function smokeCreativeReferenceUsageOtherCanonicalized(): Promise<void> {
  const runner = sequencedPlannerRunner([
    planFixture({
      createdAt: "2025-07-17T00:00:00.000Z",
      updatedAt: "2025-07-17T00:00:00.000Z",
      jobs: [
        jobFixture({
          id: "fantasy_fairy_forest",
          prompt:
            "Use the uploaded selected image as the child identity reference and create a new cute fantasy portrait in a fairy forest.",
          references: [
            {
              kind: "selected_canvas_image",
              usage: "other",
              assetId: "ref1"
            }
          ]
        }),
        jobFixture({
          id: "dreamy_cloud_castle",
          prompt:
            "Use the uploaded selected image as the child identity reference and create a new dreamy cloud castle portrait.",
          references: [
            {
              kind: "selected_canvas_image",
              usage: "other",
              assetId: "ref1"
            }
          ]
        }),
        jobFixture({
          id: "magical_enchanted_garden",
          prompt:
            "Use the uploaded selected image as the child identity reference and create a new enchanted garden portrait.",
          references: [
            {
              kind: "selected_canvas_image",
              usage: "other",
              assetId: "ref1"
            }
          ]
        })
      ]
    })
  ]);
  const result = await createGenerationPlan({
    userText: creativeReferenceUserText,
    defaults,
    selectedReferences,
    llmConfig: llmConfigFixture(),
    now,
    runner
  });

  expectPlannerOk(result, "creative reference usage is canonicalized");
  expect(runner.calls.length === 1, "usage canonicalization avoids a reflection retry");
  expect(
    result.plan.jobs.every((job) => job.references[0]?.usage === "subject"),
    "creative portrait references with usage other are converted to subject"
  );
  expect(result.plan.createdAt === now.toISOString(), "model-created plan timestamp is replaced with server time");
  expect(result.plan.updatedAt === now.toISOString(), "model-updated plan timestamp is replaced with server time");
}

async function smokePlannerReflectsOnDroppedExplicitCount(): Promise<void> {
  const runner = sequencedPlannerRunner([
    planFixture({
      jobs: [
        jobFixture({
          id: "collapsed_single",
          prompt: "Create one fashion poster.",
          count: 1
        })
      ]
    }),
    planFixture({
      jobs: [
        jobFixture({
          id: "five_variants",
          prompt: "Create five distinct fashion poster variants.",
          count: 5
        })
      ]
    })
  ]);
  const result = await createGenerationPlan({
    userText: "Generate 5 different fashion poster images.",
    defaults,
    selectedReferences: [],
    llmConfig: llmConfigFixture(),
    now,
    runner
  });

  expectPlannerOk(result, "planner reflects when explicit count is dropped");
  expect(runner.calls.length === 2, "dropped explicit count triggers one reflection");
  expect(result.plan.jobs[0]?.id === "five_variants", "reflection uses the corrected explicit-count plan");
  expect(result.plan.jobs[0]?.count === 5, "reflection preserves five requested outputs");
  const retryMessage = runner.calls[1]?.messages[1];
  expect(isRecord(retryMessage), "explicit-count reflection includes a retry prompt");
  expect(
    typeof retryMessage.content === "string" && retryMessage.content.includes("explicitly requested at least 5"),
    "explicit-count reflection prompt names the dropped count"
  );
}

async function smokeSingleCombinedSelectedReferenceLimitQuestion(): Promise<void> {
  const result = await createGenerationPlan({
    userText: "把所有图合成一张海报。",
    defaults,
    selectedReferences: selectedReferencesMany(4),
    llmConfig: llmConfigFixture(),
    now,
    runner: staticPlannerRunner(planFixture())
  });

  expect(!result.ok, "single combined output with more than three references asks for user input");
  expect(result.code === "agent_requires_user_input", "single combined output limit uses user-input code");
  expect(result.message.includes("at most 3"), "single combined output limit names the per-job reference cap");
}

async function smokeRecentOutputEditWithoutReferencesStillAsks(): Promise<void> {
  const result = await createGenerationPlan({
    userText: "让刚刚生成的所有图里面的文案字体统一。",
    defaults,
    selectedReferences: [],
    llmConfig: llmConfigFixture(),
    now,
    runner: staticPlannerRunner(planFixture())
  });

  expect(!result.ok, "recent-output edit without selected references asks for user input");
  expect(result.code === "missing_selected_canvas_reference", "recent-output edit without frontend fallback keeps missing-reference code");
}

async function smokeCombinedSelectedReferencePlan(): Promise<void> {
  const result = await createGenerationPlan({
    userText: "把两张图组合成一张旅行海报，加上标题。",
    defaults,
    selectedReferences: selectedReferencesTwo(),
    llmConfig: llmConfigFixture(),
    now,
    runner: staticPlannerRunner(
      planFixture({
        jobs: [
          jobFixture({
            id: "combined_poster",
            prompt: "Combine both selected images into one travel poster and add a refined title.",
            references: [
              {
                kind: "selected_canvas_image",
                usage: "scene",
                assetId: "ref1"
              },
              {
                kind: "selected_canvas_image",
                usage: "scene",
                assetId: "ref2"
              }
            ]
          })
        ]
      })
    )
  });

  expectPlannerOk(result, "combined selected-reference plan");
  expect(result.plan.jobs.length === 1, "combined selected reference plan may keep one job");
  expect(result.plan.jobs[0]?.references.length === 2, "combined selected reference plan keeps both references");
}

async function smokePlannerReflectsOnWrappedOutput(): Promise<void> {
  const assistantDeltas: string[] = [];
  const repairedPlan = planFixture({
    jobs: [jobFixture({ id: "repaired_final" })]
  });
  const runner = sequencedPlannerRunner([
    `Here is the plan:\n${JSON.stringify(planFixture({ jobs: [jobFixture({ id: "wrapped_final" })] }))}`,
    repairedPlan
  ]);
  const result = await createGenerationPlan({
    userText: "Create one polished hero image.",
    defaults,
    selectedReferences: [],
    llmConfig: llmConfigFixture(),
    now,
    runner,
    onAssistantDelta: (delta) => assistantDeltas.push(delta)
  });

  expectPlannerOk(result, "wrapped output is corrected after reflection");
  expect(runner.calls.length === 2, "wrapped output reflection invokes the planner twice");
  expect(result.plan.jobs[0]?.id === "repaired_final", "reflection result uses the regenerated plan");
  const retryMessage = runner.calls[1]?.messages[1];
  expect(isRecord(retryMessage), "reflection attempt includes a retry prompt");
  expect(
    typeof retryMessage.content === "string" && retryMessage.content.includes("Self-reflection retry request."),
    "reflection prompt asks the agent to reflect"
  );
  expect(
    typeof retryMessage.content === "string" && retryMessage.content.includes("invalid_plan_json"),
    "reflection prompt includes the evaluator code as feedback"
  );
  expect(
    assistantDeltas.some((delta) => delta.includes("反思")),
    "reflection attempt emits a user-facing retry status"
  );
}

async function smokePlannerReflectsOnInvalidPlan(): Promise<void> {
  const runner = sequencedPlannerRunner([
    planFixture({
      jobs: []
    }),
    planFixture({
      jobs: [jobFixture({ id: "schema_repaired_final" })]
    })
  ]);
  const result = await createGenerationPlan({
    userText: "Create one polished hero image.",
    defaults,
    selectedReferences: [],
    llmConfig: llmConfigFixture(),
    now,
    runner
  });

  expectPlannerOk(result, "invalid plan output is corrected after reflection");
  expect(runner.calls.length === 2, "plan reflection invokes the planner twice");
  expect(result.plan.jobs[0]?.id === "schema_repaired_final", "plan reflection uses the regenerated plan");
  const retryMessage = runner.calls[1]?.messages[1];
  expect(isRecord(retryMessage), "plan reflection attempt includes a retry prompt");
  expect(
    typeof retryMessage.content === "string" && retryMessage.content.includes("GenerationPlan must include at least one job."),
    "reflection prompt includes validation details"
  );
}

function smokeModelJobSizeCoercion(): void {
  const stringSizeResult = validate(
    planFixture({
      jobs: [jobFixture({ size: "1024x1024" })]
    }),
    []
  );
  expectOk(stringSizeResult, "string job size is accepted");
  expect(stringSizeResult.plan.jobs[0]?.size?.width === 1024, "string job size width is preserved");
  expect(stringSizeResult.plan.jobs[0]?.size?.height === 1024, "string job size height is preserved");

  const numericStringSizeResult = validate(
    planFixture({
      jobs: [jobFixture({ size: { width: "1024", height: "1024" } })]
    }),
    []
  );
  expectOk(numericStringSizeResult, "numeric string job size is accepted");
  expect(numericStringSizeResult.plan.jobs[0]?.size?.width === 1024, "numeric string job size width is preserved");

  const nullSizeResult = validate(
    planFixture({
      jobs: [jobFixture({ size: null })]
    }),
    []
  );
  expectOk(nullSizeResult, "null job size falls back to defaults");
  expect(nullSizeResult.plan.jobs[0]?.size === undefined, "null job size is omitted from the parsed job");
}

function smokeModelArbitraryFinalJobCount(): void {
  const result = validate(
    planFixture({
      jobs: [
        jobFixture({
          id: "travel_vlog_batch",
          prompt: "Create nine realistic travel vlog stills.",
          count: 9
        })
      ]
    }),
    []
  );

  expectOk(result, "arbitrary final job count is accepted");
  expect(result.plan.jobs.length === 1, "count 9 remains one coherent job");
  expect(result.plan.jobs[0]?.id === "travel_vlog_batch", "arbitrary-count job keeps original id");
  expect(result.plan.jobs[0]?.count === 9, "arbitrary-count job preserves requested count");
}

function smokeModelArbitraryDefaultCount(): void {
  const result = validate(
    planFixture({
      defaults: {
        ...defaults,
        count: 9
      },
      jobs: [
        jobFixture({
          id: "default_count_batch",
          prompt: "Create nine images using the plan default count.",
          count: undefined
        })
      ]
    }),
    []
  );

  expectOk(result, "arbitrary default count is accepted");
  expect(result.plan.defaults.count === 9, "arbitrary default count is preserved");
  expect(result.plan.jobs.length === 1, "default count 9 remains one coherent job");
  expect(result.plan.jobs[0]?.count === 9, "job inherits arbitrary default count");
}

function smokeModelArbitraryDependentTargetCount(): void {
  const result = validate(
    planFixture({
      jobs: [
        jobFixture({
          id: "style_anchor",
          role: "style_anchor",
          prompt: "Create one visible documentary style anchor.",
          count: 1
        }),
        jobFixture({
          id: "final_batch",
          prompt: "Create three final images using the style anchor.",
          count: 3,
          references: [
            {
              kind: "generated_output",
              usage: "style",
              jobId: "style_anchor"
            }
          ]
        })
      ],
      edges: [
        {
          fromJobId: "style_anchor",
          toJobId: "final_batch"
        }
      ]
    }),
    []
  );

  expectOk(result, "arbitrary dependent target count is accepted");
  expect(result.plan.jobs.length === 2, "dependent target count 3 remains one coherent job plus anchor");
  expect(result.plan.jobs[1]?.count === 3, "dependent target preserves requested count");
  expect(result.plan.edges.length === 1, "incoming dependency edge stays attached to the coherent target job");
}

function smokeModelUnsupportedSourceJobCountRejection(): void {
  const result = validate(
    planFixture({
      jobs: [
        jobFixture({
          id: "multi_anchor",
          role: "style_anchor",
          prompt: "Create three style anchors.",
          count: 3
        }),
        jobFixture({
          id: "final_image",
          references: [
            {
              kind: "generated_output",
              usage: "style",
              jobId: "multi_anchor"
            }
          ]
        })
      ],
      edges: [
        {
          fromJobId: "multi_anchor",
          toJobId: "final_image"
        }
      ]
    }),
    []
  );

  expect(!result.ok, "unsupported source job count is still rejected");
  expect(result.code === "invalid_dependency_source_count", "multi-output source count keeps the dependency validation code");
}

function smokeModelOptionalOutputAliases(): void {
  const result = validate(
    planFixture({
      defaults: {
        ...defaults,
        quality: "standard",
        outputFormat: "image/png",
        count: "1"
      },
      jobs: [
        jobFixture({
          quality: "high_quality",
          outputFormat: {
            value: "jpg"
          },
          count: "1"
        })
      ]
    }),
    []
  );

  expectOk(result, "model optional output aliases are accepted");
  expect(result.plan.defaults.quality === "medium", "default standard quality maps to medium");
  expect(result.plan.defaults.outputFormat === "png", "image/png output format maps to png");
  expect(result.plan.defaults.count === 1, "string default count maps to number");
  expect(result.plan.jobs[0]?.quality === "high", "job high_quality maps to high");
  expect(result.plan.jobs[0]?.outputFormat === "jpeg", "job jpg object maps to jpeg");
  expect(result.plan.jobs[0]?.count === 1, "string job count maps to number");

  const fallbackResult = validate(
    planFixture({
      jobs: [
        jobFixture({
          quality: "black",
          outputFormat: "logo"
        })
      ]
    }),
    []
  );

  expectOk(fallbackResult, "unsupported optional output fields fall back instead of rejecting");
  expect(fallbackResult.plan.jobs[0]?.quality === undefined, "unsupported job quality is omitted");
  expect(fallbackResult.plan.jobs[0]?.outputFormat === undefined, "unsupported job outputFormat is omitted");
}

function smokeModelReferenceAliases(): void {
  const result = validate(
    planFixture({
      jobs: [
        jobFixture({
          id: "style_anchor",
          role: "style_anchor",
          prompt: "Create one visible picture book style anchor.",
          count: 1
        }),
        jobFixture({
          id: "page_1",
          references: [
            {
              type: "generated_output",
              usage: "style",
              sourceJobId: "style_anchor"
            }
          ]
        })
      ],
      edges: [
        {
          from: "style_anchor",
          to: "page_1"
        }
      ]
    }),
    []
  );

  expectOk(result, "model reference aliases are accepted");
  expect(result.plan.jobs[1]?.references[0]?.kind === "generated_output", "reference type alias maps to kind");
  expect(result.plan.jobs[1]?.references[0]?.jobId === "style_anchor", "sourceJobId alias maps to jobId");
  expect(result.plan.edges[0]?.fromJobId === "style_anchor", "edge from alias maps to fromJobId");
  expect(result.plan.edges[0]?.toJobId === "page_1", "edge to alias maps to toJobId");
}

function smokeModelJobRoleAliases(): void {
  const result = validate(
    planFixture({
      jobs: [
        jobFixture({
          id: "hero_main",
          role: "main_image",
          prompt: "Create one polished ecommerce hero image."
        }),
        jobFixture({
          id: "image_generation_job",
          role: "image_generation",
          prompt: "Create one generated listing image."
        }),
        jobFixture({
          id: "style_reference",
          role: "style_reference",
          prompt: "Create one visible style reference image.",
          count: 1
        }),
        jobFixture({
          id: "base_reference",
          role: "base_image",
          prompt: "Create one visible generated source reference.",
          count: 1
        }),
        jobFixture({
          id: "hero_variant",
          role: "variant",
          prompt: "Create one alternate crop of the hero image."
        })
      ]
    }),
    []
  );

  expectOk(result, "model job role aliases are accepted");
  expect(result.plan.jobs[0]?.role === "final_image", "main_image role maps to final_image");
  expect(result.plan.jobs[1]?.role === "final_image", "image_generation role maps to final_image");
  expect(result.plan.jobs[2]?.role === "style_anchor", "style_reference role maps to style_anchor");
  expect(result.plan.jobs[3]?.role === "reference_anchor", "base_image role maps to reference_anchor");
  expect(result.plan.jobs[4]?.role === "variation", "variant role maps to variation");
}

function validate(plan: Record<string, unknown>, references: AgentSelectedCanvasReference[]): GenerationPlanValidationResult {
  return validateGenerationPlan(plan, {
    defaults,
    selectedReferences: references,
    now,
    planId: "plan-test"
  });
}

function planFixture(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: "plan-draft",
    title: "Smoke plan",
    status: "awaiting_confirmation",
    defaults,
    jobs: [jobFixture()],
    edges: [],
    createdBy: "agent",
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    ...overrides
  };
}

function jobFixture(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: "final_image",
    role: "final_image",
    prompt: "Create one polished image.",
    count: 1,
    references: [],
    status: "queued",
    outputs: [],
    visible: true,
    ...overrides
  };
}

function expectOk(
  result: GenerationPlanValidationResult,
  label: string
): asserts result is Extract<GenerationPlanValidationResult, { ok: true }> {
  if (!result.ok) {
    throw new Error(`${label} failed validation: ${result.message}`);
  }
}

function expectPlannerOk(
  result: AgentPlannerResult,
  label: string
): asserts result is Extract<AgentPlannerResult, { ok: true }> {
  if (!result.ok) {
    throw new Error(`${label} failed planning: ${result.message}`);
  }
}

function expect(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function fileDataText(value: unknown): string {
  if (!isRecord(value)) {
    return "";
  }

  const content = value.content;
  if (typeof content === "string") {
    return content;
  }

  return Array.isArray(content) ? content.join("\n") : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function selectedReferencesTwo(): AgentSelectedCanvasReference[] {
  return [
    ...selectedReferences,
    {
      id: "shape-ref-2",
      assetId: "asset-ref-2",
      label: "Second scenic image",
      width: 1024,
      height: 1024,
      mimeType: "image/png",
      dataUrl: "data:image/png;base64,BBBB"
    }
  ];
}

function selectedReferencesMany(count: number): AgentSelectedCanvasReference[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `shape-ref-${index + 1}`,
    assetId: `asset-ref-${index + 1}`,
    label: `Selected image ${index + 1}`,
    width: 1024,
    height: 1024,
    mimeType: "image/png",
    dataUrl: `data:image/png;base64,REF${index + 1}`
  }));
}

function llmConfigFixture(overrides: Partial<UsableAgentLlmConfig> = {}): UsableAgentLlmConfig {
  return {
    apiKey: "test-key",
    model: "deepseek-chat",
    timeoutMs: 60000,
    supportsVision: false,
    ...overrides
  };
}

function staticPlannerRunner(output: unknown): NonNullable<Parameters<typeof createGenerationPlan>[0]["runner"]> {
  return {
    async invoke() {
      return {
        messages: [
          {
            content: JSON.stringify(output)
          }
        ]
      };
    }
  };
}

function capturingPlannerRunner(output: unknown): NonNullable<Parameters<typeof createGenerationPlan>[0]["runner"]> & {
  calls: Array<{ messages: unknown[]; files?: Record<string, unknown> }>;
} {
  const calls: Array<{ messages: unknown[]; files?: Record<string, unknown> }> = [];
  return {
    calls,
    async invoke(input) {
      calls.push({
        messages: input.messages,
        files: input.files as Record<string, unknown> | undefined
      });
      return {
        messages: [
          {
            content: JSON.stringify(output)
          }
        ]
      };
    }
  };
}

function sequencedPlannerRunner(outputs: unknown[]): NonNullable<Parameters<typeof createGenerationPlan>[0]["runner"]> & {
  calls: Array<{ messages: unknown[] }>;
} {
  const calls: Array<{ messages: unknown[] }> = [];
  return {
    calls,
    async invoke(input) {
      calls.push({ messages: input.messages });
      const output = outputs[Math.min(calls.length - 1, outputs.length - 1)];
      return {
        messages: [
          {
            content: typeof output === "string" ? output : JSON.stringify(output)
          }
        ]
      };
    }
  };
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
