import { z } from "zod";

const text = (length) => z.string().trim().min(1).max(length);

export const querySchema = z.strictObject({
  query: text(255).describe("字段中文名、编码、别名或包含字段名的简短问句"),
  crfTable: text(255).optional().describe("可选的 CRF 所属表，例如症状表"),
});

export const entrySchema = z.strictObject({
  conceptCode: z.string().trim().regex(/^[a-z][a-z0-9_]{0,49}$/),
  label: text(255),
  englishName: text(255),
  crfTable: text(255).optional().describe("来源中已确认的 CRF 所属表"),
  aliases: z.array(text(255)).max(20).default([]),
  definition: text(2000),
  valueType: z.enum(["number", "integer", "text", "boolean", "date", "coded"]),
  unit: text(50).nullable(),
  ruleText: text(4000).describe("原始提取规则。引用来源中的表述，保留适用条件"),
  gaps: z.array(text(500)).max(15).default([]),
  source: z.strictObject({
    document: text(255).describe("资料名称，或可供核查的文档标识"),
    locator: text(255).describe("资料内的位置，例如工作表及单元格范围"),
    sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  }),
});

export const coughDuration = entrySchema.parse({
  conceptCode: "sym_cough_duration",
  label: "咳嗽_时长",
  englishName: "Cough duration",
  crfTable: "症状表",
  aliases: ["咳嗽时长"],
  definition: "主诉或现病史中患者就诊时自我报告的咳嗽时长。",
  valueType: "number",
  unit: "月",
  ruleText: "表现包含咳嗽/咳喘，后面的时间、数量包含天、周、月、年，取时间、数量",
  gaps: [
    "原表未定义如何将天、周、年换算为月。",
    "原表未定义同一记录中多个时长的选取规则。",
    "原表未定义否认咳嗽或未记录时的取值。",
  ],
  source: {
    document: "慢阻肺CRF量表（含提取规则）_疑问错误标注.xlsx",
    locator: "慢阻肺CRF量表!B57:H57",
    sha256: "e8e9dfefd4f5da7dd2ecb30f673f8456ce8e6406f083c7d06fd955c88bb5a3a5",
  },
});

export function normalizeTerm(value) {
  return value.normalize("NFKC").toLowerCase().replace(/[\s_]+/gu, "");
}

export function questionTerm(question) {
  const field = question
    .normalize("NFKC")
    .replace(/[?!.。]+$/u, "")
    .replace(/^(?:请问|请解释)\s*/u, "")
    .replace(/(?:的)?(?:有什么表现|有哪些表现|有什么规则|规则是什么|怎么提取|如何提取|怎么取|的单位是什么|单位是什么|是什么|换算规则|单位|定义|含义|提取规则|规则|表现)$/u, "");
  // Keep modifiers such as 加重 when converting a duration question to a field name.
  const duration = field.match(/^(?:(?:如何|怎么)(?:记录|提取)\s*)?(.+?)(?:的)?\s*持续(?:了?(?:多久|多长时间)|时间)$/u);
  return normalizeTerm(duration ? `${duration[1]}时长` : field);
}
