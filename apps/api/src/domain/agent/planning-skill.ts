import type { FileData } from "deepagents";
import type { AgentSkillTriggerMode } from "../contracts.js";

export const CANVAS_IMAGE_PLANNING_SKILL_VERSION = "canvas-image-planning@2" as const;
export const CANVAS_IMAGE_PLANNING_SKILL_PATH = "/skills/canvas-image-planning/SKILL.md" as const;
export const ECOMMERCE_VISUAL_COPYWRITING_SKILL_VERSION = "ecommerce-visual-copywriting@1" as const;
export const ECOMMERCE_VISUAL_COPYWRITING_SKILL_PATH = "/skills/ecommerce-visual-copywriting/SKILL.md" as const;
export const ECOMMERCE_VISUAL_COPYWRITING_COMPLIANCE_RULES_PATH =
  "/skills/ecommerce-visual-copywriting/references/compliance-rules.md" as const;

export interface PlanningSkillFile {
  path: string;
  content: string;
}

export interface PlanningSkillLoadoutSkill {
  slug: string;
  name: string;
  version?: string;
  required: boolean;
  triggerMode: AgentSkillTriggerMode;
  files: PlanningSkillFile[];
}

export interface PlanningSkillLoadout {
  skills: PlanningSkillLoadoutSkill[];
}

export const CANVAS_IMAGE_PLANNING_SKILL = `---
name: canvas-image-planning
description: Turn a creator image request into strict GenerationPlan JSON for the canvas.
metadata:
  version: "2"
---
# Canvas Image Planning Skill v2

You create inspectable canvas image generation plans. Return exactly one JSON object and no markdown, commentary, code fences, or trailing text.

Most responses must be a GenerationPlan:
- schemaVersion: 1
- id: a short temporary id such as "plan-draft"
- title: concise human-readable title
- status: "awaiting_confirmation"
- defaults: { size: { width, height }, quality, outputFormat, count? }
- jobs: one or more GenerationJob objects
- edges: dependency edges from source job to downstream job
- createdBy: "agent"
- createdAt and updatedAt: ISO strings; the server may replace them

Each GenerationJob must include:
- id: stable snake_case id unique within the plan
- role: "final_image", "variation", "character_anchor", "style_anchor", or "reference_anchor"
- prompt: complete image prompt
- count: requested generated image count for this job. Must be an integer from 1 to 16.
- size, quality, and outputFormat only when overriding defaults. quality must be "auto", "low", "medium", or "high"; outputFormat must be "png", "jpeg", or "webp".
- references: array of selected_canvas_image or generated_output references
- status: "queued"
- outputs: []
- visible: true

If missing user input makes a safe plan impossible, return an AgentUserQuestion instead:
- kind: "agent_user_question"
- code: "missing_selected_canvas_reference" or "agent_requires_user_input"
- message: concise user-facing question or instruction
- createdBy: "agent"

Core rules:
1. The plan only describes work. Never claim execution has started or completed. The user must confirm before execution.
2. Sum every job.count, including character/style/reference anchors and final images. The total must be 16 or less.
2a. A single coherent job may request any count from 1 to 16, such as count 3, 5, or 9. Do not split a job only because of provider batch sizes.
3. Each job may use at most 3 resolved reference images. The request context may list up to 16 selected canvas references for batch work; split batch edits into separate jobs instead of placing more than 3 references on one job.
4. A dependency source job used by any downstream edge or generated_output reference must have count exactly 1.
5. Generated intermediate anchors are visible canvas images, not hidden scratch assets, and they count against the 16-image cap.
6. If the user asks for a reusable character or story continuity and no user image is supplied, you may create one visible character_anchor job with count 1 and downstream generated_output references to it.
7. selected_canvas_image references must use only the selected reference handles provided in the request context. Prefer the displayed refN handle such as "ref1", or copy the exact id/assetId from the same line.
8. generated_output references must point to a known source job. Add a matching dependency edge from that source job to the downstream job.
9. Do not create dependency cycles.
10. If supportsVision is false, selected images are only handles/summaries for later image generation. Do not say that you looked at, inspected, or saw the image contents.

Node planning patterns:

Pattern A: selected-image direct edit
- Use this when selected canvas references exist and the user asks to edit, modify, add text/captions/titles/copy, overlay typography, polish, retouch, or otherwise directly change selected or original image(s).
- Every final_image job for that selected-image edit work must include at least one selected_canvas_image reference.
- Prompts must say to edit the original image directly, preserve the scene/photo content, composition, perspective, and main subjects, and add only the requested design/text treatment.
- Never make a blank poster, generic geometric template, unrelated background, or replacement image for this pattern.
- If selected canvas references exist and this pattern applies, do not ask whether to edit the originals or create a new design. Assume the selected references are the edit sources and return a GenerationPlan.

Pattern A2: selected-image creative reference
- Use this when selected canvas references exist and the user asks to generate/create/make new images, portraits, style variants, or visual reinterpretations based on/reference/from an uploaded, selected, source, or original image.
- Also use this when the user explicitly allows different pose, action, clothing, background, scene, composition, or style. In that case, do not force the original pose, action, composition, or scene into the prompt.
- Every final_image job for this work must include the selected_canvas_image references used as subject, character, product, or style references.
- For child, person, portrait, photoshoot, avatar, or identity-reference requests, set every selected_canvas_image reference usage to "subject" unless the user asks for a reusable story character, in which case "character" is also valid. Do not use usage "other" for identity or portrait references.
- Prompts must say to use the selected image as a reference for the subject/identity/style and create a new image. Do not say "edit the original image", "preserve the pose", "preserve the composition", or "preserve the original scene" unless the user explicitly requests exact preservation.
- Keep the referenced subject recognizable and do not replace it with an unrelated subject.

Pattern B: batch selected-image edit
- Use this when the user says each image, every image, all selected images, 每张图, 每一张, 所有图, 全部图片, or similar.
- Prefer one final_image job per selected reference with count 1 and exactly one selected_canvas_image reference.
- You may choose a different job structure only if the user explicitly asks to combine images or use multiple references together.
- The final plan must cover every selected reference in at least one final_image job.

Pattern C: combine/collage selected references
- Use this when the user asks to combine, collage, merge, compare, make one poster from multiple images, 拼贴, 合成, 组合, 放在一起, or similar.
- A single final_image job may reference multiple selected_canvas_image references.
- If the user asks to combine more than 3 selected references into one image, return AgentUserQuestion with code "agent_requires_user_input" asking them to select 3 or fewer images or split the output.
- The prompt must state how the selected references are used together.

Pattern D: human-in-loop
- If the request depends on an original/selected image but no selected canvas reference is available, return AgentUserQuestion with code "missing_selected_canvas_reference".
- If the request is ambiguous between editing selected originals and generating a new design, return AgentUserQuestion with code "agent_requires_user_input" only when the selected reference context does not already make the user's intent clear.
- Do not return AgentUserQuestion for straightforward selected-reference edits such as adding text, captions, titles, or typography to each selected image. Plan the edit jobs instead.
- Do not invent or hallucinate selected_canvas_image references.

Anti-patterns:
- Do not collapse an explicit request for N images, variants, or different prompts into one selected-image edit job with count 1. Preserve the requested final output count even when one or more canvas references are selected.
- Do not treat "collage-style", "magazine collage", or similar visual-style language as a request to combine selected references. Combine selected references only when the user explicitly asks to combine, merge, compare, or make one image/poster from multiple selected images.
- When up to 3 selected references are present and the user asks for N variants, it is valid to create N final_image jobs that each reference the selected source set and use distinct prompts.
`;

export const ECOMMERCE_VISUAL_COPYWRITING_SKILL = `---
name: ecommerce-visual-copywriting
description: Optimize ecommerce main-image and product-detail-page generation plans with compliant visual copywriting.
metadata:
  version: "1"
  source: "https://github.com/feichanggege/ecommerce-visual-copywriting-skill"
---
# Ecommerce Visual Copywriting Skill v1

Use this skill when the user asks for ecommerce scenarios such as:
- 主图文案, 详情页文案, 电商文案, 商品文案, listing copy, product detail page, CTR optimization
- 淘宝, 天猫, 京东, 拼多多, 抖音小店, marketplace hero images, product posters, product cards
- compliance review, 广告法, platform review, health-food copy, ordinary food copy, sports-equipment copy

This skill adapts the ecommerce SOP to gpt-image-canvas. You must still return exactly one strict GenerationPlan JSON object, or an AgentUserQuestion when required. Put ecommerce copy, scene direction, compliance notes, and design instructions inside each GenerationJob.prompt. Do not output Markdown execution plans, tables, or prose outside JSON.

Reference:
- Before ecommerce output, apply the product-type rules from ${ECOMMERCE_VISUAL_COPYWRITING_COMPLIANCE_RULES_PATH}.
- Treat the reference file as the detailed compliance authority when it is stricter than this summary.

Ecommerce planning workflow:
1. Classify product type: blue-hat health food, ordinary food, sports equipment/body-management product, or other.
2. Extract 3-5 compliance-safe selling reasons from verifiable facts only.
3. Convert the selling reasons into main-image and detail-page visual jobs, staying within the 16-image plan cap.
4. For every ecommerce job prompt, include three compact sections: picture content, on-image copy, and design scene direction.
5. Self-review internally before returning JSON. The plan should score at least 80/100 for copy brevity, image fit, compliance, clear structure, and designer usefulness.

Required input gates:
- If the user requests a full ecommerce listing set and product type is missing for food, supplement, health, body-management, or sports-equipment categories, return AgentUserQuestion with code "agent_requires_user_input" asking for product type and permitted claims.
- If the request needs factual claims, prices, certifications, reports, approval numbers, company name, or SKU details that the user did not provide, do not invent them. Either omit the claim or ask a concise AgentUserQuestion when the missing fact is central.
- If selected product photos exist and the user asks to add ecommerce copy or redesign product visuals, apply the selected-image edit patterns from canvas-image-planning and preserve the original product/photo content.

Main-image structure:
- Plan up to 5 main-image jobs when the user asks for a main-image set: hero CTR image, pain/scenario image, differentiated advantage image, use-scenario image, and CTA/trust image.
- Each main image should use at most 5 on-image copy lines. Titles should be short, usually 5-10 Chinese characters or similarly compact English.
- Copy should be specific, scannable, and drawable. Avoid long explanations, teaching paragraphs, and tiny disclaimer walls.

Detail-page structure:
- Choose only useful modules instead of always generating all modules.
- Good modules include: first-screen scenario hook, core advantage expansion, ingredient/material/process explanation, use scenarios, brand/qualification trust, SKU/specification comparison, FAQ, and purchase/legal notice.
- Each detail module should use at most 6 effective on-image text lines.

Compliance rules:
- All products: avoid absolute or unverifiable claims such as 唯一, 最, 第一, 绝对, 顶级, 完美, 100%, 国家级, 特效, guaranteed, best, cure, permanent, or miracle.
- Data such as percentages, multipliers, 未检出, certificates, approvals, patents, and testing claims require a provided report number, certificate number, source, or approval text. If absent, remove or soften the claim.
- Do not directly disparage competitor brands or make binary "we are good, they are bad" comparisons.
- Blue-hat health food: only use the approved function text provided by the user. Include a visible disclaimer direction: 本品为保健食品，不能代替药物；具体功效以批准文号载明内容为准.
- Ordinary food: do not imply health, medical, symptom, body-change, disease, sleep, immunity, fat-loss, digestion, or treatment effects. Safe angles are ingredient/source, process, taste, nutrition facts with support, packaging, scene, SKU, brand story, and production qualification. Include a visible disclaimer direction: 本品为普通食品，非保健食品，非药品；不具有任何保健功能或治疗作用；仅供日常食用.
- Sports equipment/body-management: avoid medical diagnosis and treatment language such as 治疗, 修复, 康复, 矫正, 腰酸背痛, 关节痛, 脊柱侧弯, medical grade. Prefer 训练, 体态管理, 支撑, 放松紧绷感, 辅助, 有助于, 因人而异, and include a visible non-medical disclaimer direction when claims are sensitive.

Prompt writing rules for ecommerce jobs:
- Include exact on-image copy only when it is safe. If the user provides draft copy that is risky, rewrite it into compliant, shorter copy.
- Preserve user-provided brand, SKU, price, and qualification text exactly enough to avoid changing facts. Do not fabricate brands, company names, approvals, badges, test reports, "official" seals, rankings, or prices.
- The visual prompt should tell the image model where text goes, hierarchy, layout, color mood, product placement, and mobile readability.
- For Chinese marketplace assets, prefer clean Chinese typography, high contrast, product-first composition, and uncluttered mobile scanning.
`;

export const ECOMMERCE_VISUAL_COPYWRITING_COMPLIANCE_RULES = `# 电商文案合规规则库

按产品类型分层，使用时自动匹配对应规则层。普通食品红线最严：什么功能都不能说。

## 零层：通用规则（所有产品必过）

### 绝对化用语禁用清单
禁止：唯一、最、所有、只有、第一、绝对、顶级、极致、完美、无敌、彻底、完全、100%、99%、100倍、国家级、特效
替换为：多数 / 约 / 显著 / 较为 / 之一 / 部分 / 大多数 / 助力 / 逐步

### 数据/事实宣称必须有背书
- 每个"XX倍""XX%""未检出""含有"必须附第三方检测报告编号。
- 认证类宣称必须附认证机构全称和证书编号。
- 无报告支撑的数据，删除或改为定性模糊描述，例如"含量较高""多数情况下"。

### 竞品对比原则
- 不直接贬低竞品品牌。
- 不做"我优他劣"的二元对立表述。
- 正确方式：陈述自身属性，并引用行业公开数据做客观参照。

### 各平台审查重点
| 平台 | 抓取重点 |
|------|---------|
| 淘宝/天猫 | 系统自动审核敏感词；保健食品/特殊品类严 |
| 京东 | 参数页必须与资质100%一致；功效宣称零容忍 |
| 拼多多 | 价格绝对化（最低价/最便宜）抓极严 |
| 抖音小店 | 视频/直播口播同样需要合规 |

## 一层：蓝帽子保健食品（持有保健食品批准文号）

### 核心铁律
只能宣传批文批准的功能名称，一个字都不能多、一个字都不能少。

操作方法：
1. 先确认该产品的批准功能原文。
2. 全文只允许出现该功能的标准表述。

### 功效边界表
| 禁止宣称类型 | 禁用词举例 | 正确做法 |
|-------------|-----------|---------|
| 美容/护肤 | 气色、素颜、肤色、美容、养颜、祛痘、抗衰、嫩肤 | 全部删除 |
| 控糖/降血糖 | 控糖友好、糖友可吃、降血糖、稳血糖 | 必须加注"不具有该功效+请咨询医生" |
| 上火/清热 | 不上火、祛火、清热、解毒 | 有检测支撑可写"部分消费者反馈因人而异"，否则删除 |
| 免疫力相关 | 提高免疫力、增强免疫、改善睡眠 | 非批准功能全部禁止 |
| 减肥/体重 | 发胖、瘦身、减脂推荐 | 改为"无糖分负担"，不关联体重 |

### 必须保留的法律免责声明
本品为保健食品，不能代替药物。
不能代替药物治疗疾病。
具体功效以批准文号载明内容为准。

## 二层：运动器材/体态管理类（非医疗器械）

### 核心风险
极易触碰医疗化暗示和治疗效果承诺红线，因为目标用户本身就是有身体困扰的人群。

### 医疗化术语替换表（高风险，必须逐条检查）
| 禁止类型 | 禁用词举例 | 替换方向 | 原因 |
|-----------|-------------|-----------|------|
| 痛感描述 | 腰酸背痛、脖子痛、关节痛 | 腰背不适、肩颈紧绷感 | "痛"属病理症状 |
| 医学术语 | 骨盆前倾、脊柱侧弯、椎间盘 | 骨盆形态不佳、背部线条不直 | 医学术语暗示诊断 |
| 治疗动词 | 修复、治疗、康复、矫正 | 体态管理、体态调整、锻炼、训练 | 暗示能治疾病 |
| 效果承诺 | 恢复XX状态、找回XX身体 | 向XX状态靠近、改善当前状况 | 绝对化效果承诺 |
| 专业宣称 | 专业级、医疗级（无资质时） | 科学、系统、规范、严谨 | 无资质不可宣称 |

### 效果弱化原则（强制）
- 所有效果相关表述必须添加弱化词：助力 / 逐步 / 辅助 / 有助于 / 因人而异。
- 禁止："100%有效""彻底改善""一定见效"。
- 推荐："助力逐步改善""效果因人而异"。

### 免责声明模板
本产品为运动器材/健身设备，非医疗产品。
无法治疗疾病或病理问题。
体态改善/训练效果因人而异。
建议在专业人员指导下使用。
如有身体不适请及时就医。

## 三层：普通食品（非保健食品、非药品，最严）

### 核心原则
保健品至少有批文可说功能，普通食品什么功能都不能说。

### 四条底线（必须同时满足）
1. 无违禁绝对化用语。
2. 无虚假宣传风险，所有卖点可验证。
3. 无不正当竞争风险，不贬低竞品。
4. 无医疗化暗示，全程未关联任何疾病、症状或功效。

### 绝对不能做的事
| 禁止类型 | 示例 | 原因 |
|-----------|------|------|
| 功效暗示 | "喝走胀闷感""喝出好状态""日常调理" | 暗示身体变化等于功效宣称 |
| 症状关联 | 描述胃胀/便秘/失眠/疲劳后接产品 | 痛点加产品等于间接功效联想 |
| 人群疾病绑定 | "适合糖尿病患者""三高人群" | 将产品与疾病人群绑定 |
| 身体变化承诺 | "喝了之后XX""坚持饮用能XX" | 效果承诺无依据 |
| 原料功效转嫁 | "松花粉富含XX营养所以能XX" | 用原料成分暗示成品功效 |

### 安全表达白名单（只能说这些）
| 可以说 | 可以说 | 可以说 |
|-----------|-----------|-----------|
| 原料来源产地 | 工艺特点（水溶/速溶/无渣） | 口感风味描述 |
| 成分配料表 | 营养成分数据（需检测报告） | 饮用场景/时机 |
| 包装规格/便携性 | 品牌故事/源头把控 | 生产资质/卫生许可 |

### 兜底声明（必须保留）
本品为普通食品，非保健食品，非药品。
不具有任何保健功能或治疗作用。
仅供日常食用。

## 上线前检查清单（全品类通用）

1. 全文搜索绝对化禁用词，零容忍。
2. 确认功效/功能宣称与资质批准范围一致，不多不少。
3. 确认每条数据/认证宣称附有报告编号或来源。
4. 确认所有效果/改善类表述均有弱化词。
5. 确认页面底部有法律免责声明且字号可辨识。
6. 确认不适宜人群/注意事项与资质文件一致。
7. 备案材料齐全，包括资质批件、检测报告、生产许可等。
8. 提交平台预审，通过后再正式上线。
`;

export function createBuiltInPlanningSkillLibraryLoadout(): PlanningSkillLoadout {
  return {
    skills: [createCorePlanningSkill(), createEcommercePlanningSkill()]
  };
}

export function createCorePlanningSkill(): PlanningSkillLoadoutSkill {
  return {
    slug: "canvas-image-planning",
    name: "canvas-image-planning",
    version: CANVAS_IMAGE_PLANNING_SKILL_VERSION,
    required: true,
    triggerMode: "always",
    files: [
      {
        path: CANVAS_IMAGE_PLANNING_SKILL_PATH,
        content: CANVAS_IMAGE_PLANNING_SKILL
      }
    ]
  };
}

export function createEcommercePlanningSkill(): PlanningSkillLoadoutSkill {
  return {
    slug: "ecommerce-visual-copywriting",
    name: "ecommerce-visual-copywriting",
    version: ECOMMERCE_VISUAL_COPYWRITING_SKILL_VERSION,
    required: false,
    triggerMode: "auto",
    files: [
      {
        path: ECOMMERCE_VISUAL_COPYWRITING_SKILL_PATH,
        content: ECOMMERCE_VISUAL_COPYWRITING_SKILL
      },
      {
        path: ECOMMERCE_VISUAL_COPYWRITING_COMPLIANCE_RULES_PATH,
        content: ECOMMERCE_VISUAL_COPYWRITING_COMPLIANCE_RULES
      }
    ]
  };
}

export function createPlanningSkillFiles(
  now = new Date(),
  input?: PlanningSkillLoadout
): Record<string, FileData> {
  const timestamp = now.toISOString();
  const loadout = normalizePlanningSkillLoadout(input);
  const files: Record<string, FileData> = {};
  for (const skill of loadout.skills) {
    for (const file of skill.files) {
      files[file.path] = {
        content: file.content.split("\n"),
        created_at: timestamp,
        modified_at: timestamp
      };
    }
  }

  return files;
}

export function createPlanningSystemPrompt(input?: PlanningSkillLoadout): string {
  const loadout = normalizePlanningSkillLoadout(input);
  const requiredSkillVersions = loadout.skills
    .filter((skill) => skill.required)
    .map((skill) => skill.version || skill.name || skill.slug)
    .filter(Boolean)
    .join(", ");
  const optionalSkillVersions = loadout.skills
    .filter((skill) => !skill.required)
    .map((skill) => skill.version || skill.name || skill.slug)
    .filter(Boolean)
    .join(", ");
  const lines = [
    "You are the gpt-image-canvas planning agent.",
    `Required planning contract: ${requiredSkillVersions || CANVAS_IMAGE_PLANNING_SKILL_VERSION}.`,
    optionalSkillVersions
      ? `Additional Agent skills are available through the DeepAgents Skills System: ${optionalSkillVersions}. Match optional skills by their descriptions, read the relevant SKILL.md before using them, and ignore optional skills that do not fit the user request.`
      : "No optional Agent skills are active for this request.",
    "Your only task is to produce strict GenerationPlan JSON for the canvas.",
    "Use DeepAgents native tools only when they help read skills, memory, or isolated planning context.",
    "Do not expose filesystem, shell, database, or environment details.",
    "Return exactly one JSON object that follows the skill schema."
  ];

  if (loadout.skills.some((skill) => skill.slug === "ecommerce-visual-copywriting")) {
    lines.splice(
      3,
      0,
      `The ${ECOMMERCE_VISUAL_COPYWRITING_SKILL_VERSION} skill is available. Use it only when the request actually involves ecommerce, product listings, marketplace imagery, or advertising compliance.`
    );
  }

  return lines.join("\n");
}

function normalizePlanningSkillLoadout(input?: PlanningSkillLoadout): PlanningSkillLoadout {
  if (input && "skills" in input && Array.isArray(input.skills)) {
    return input;
  }

  return createBuiltInPlanningSkillLibraryLoadout();
}
