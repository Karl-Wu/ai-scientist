# 专病知识库

专病知识库是独立运行的 Node.js + SQLite 服务，通过 MCP Streamable HTTP 提供词条检索和新建。术语保存到 OMOP CDM 5.5 词汇实体表，提取规则和出处保存到本地规则表。新数据库第一次初始化时写入从慢阻肺 CRF 工作簿核验的「咳嗽_时长」示例。保留表结构并清空记录的数据库，在重新启动后仍为空，首次新增词条时会同时创建对应词汇集。Agent 新建词条后，其他连接可立即读取。

## 启动服务

需要 Node.js 22.19 或更新版本。在 macOS 或 Linux 上，从仓库根目录运行下列命令。将同一个 `KADY_KB_TOKEN` 注入知识服务和 Kady 后端的进程环境。正式使用时，请把令牌交给两边的服务管理器保存。

```bash
npm ci --prefix knowledge-service
export KADY_KB_TOKEN="9b39ddaea51214afdd11e234be1432d02f1105840c69a9c9bd65d45c7d31c41e" or $(openssl rand -hex 32)
./knowledge-service/knowledge.sh start
```

脚本会等待服务成功监听再返回。日志写在 `knowledge-service/.runtime/knowledge.log`。用下面的命令停止服务，停止时无需令牌。重复执行 `start` 或 `stop` 会返回当前状态。

```bash
./knowledge-service/knowledge.sh stop
```

在 Windows 上，可在配置令牌后用 `npm start --prefix knowledge-service` 前台启动，按 `Ctrl+C` 停止。

MCP 地址为 `http://127.0.0.1:8100/mcp`。服务启动后，在另一个终端执行 `curl -fsS http://127.0.0.1:8100/health`，应收到 `{"status":"ok"}`。

| 环境变量 | 用途 |
| --- | --- |
| `KADY_KB_TOKEN` | 必填。Agent 凭此检索和新建词条。 |
| `KADY_KB_READ_TOKEN` | 可选。Agent 凭此连接时只会看到 `kb_search`。 |
| `KADY_KB_DB` | 持久化数据库路径，默认 `knowledge-service/data/crf.sqlite`。 |
| `KADY_KB_HOST` | 监听地址，默认 `127.0.0.1`。 |
| `KADY_KB_PORT` | 监听端口，默认 `8100`。 |
| `KADY_KB_RUN_DIR` | `knowledge.sh` 的 PID 和日志目录，默认 `knowledge-service/.runtime`。启动和停止同一实例时使用相同目录。 |

两个令牌需为不同的随机字符串，长度 24–256，使用不带空格的可打印 ASCII 字符。跨机器部署时，经内网 HTTPS 反向代理连接服务，将代理地址配置到 Kady。

## 连接 Kady

在 Kady 的 `ods-Test` 项目中打开 **Settings → Connectors → Add server**，选择 **This project → Remote HTTP**。连接器标识填写 `clinical-kb`，URL 填写 `http://127.0.0.1:8100/mcp`，认证选择 **Bearer token**，值填写 `${KADY_KB_TOKEN}`，工具暴露选择 **Direct**。Kady 的连接器标识使用 ASCII，MCP 服务显示名为「专病知识库」。

也可以将下面的 `clinical-kb` 条目合并到项目的 `sandbox/.pi/mcp.json` 的 `mcpServers` 对象中。只读接入时，改用 `Bearer ${KADY_KB_READ_TOKEN}`，并将对应令牌注入 Kady 后端环境。

```json
{
  "mcpServers": {
    "clinical-kb": {
      "url": "http://127.0.0.1:8100/mcp",
      "headers": { "Authorization": "Bearer ${KADY_KB_TOKEN}" },
      "exposure": "direct",
      "description": "专病知识库。查询慢阻肺 CRF 字段的定义、提取规则、单位和原始出处。用户要求维护时可新增词条。字段有歧义或写入资料不完整时，使用 interview 请用户确认。"
    }
  }
}
```

测试连接并保存后，打开新对话，试问「请使用专病知识库查询，咳嗽_时长有什么表现？」。如果项目原有 CRF 指令优先查询本地文件，将专病知识库设为已收录词条的首选，以便普通问句也走 MCP。

## 工具合同

| 工具 | 行为 |
| --- | --- |
| `kb_search` | 接受字段编码、中文名、英文名、别名或包含常见问法的简短问题。可用 `crfTable` 限定所属表。优先查编码，然后匹配名称。返回 `found`、`ambiguous` 或 `not_found`。`found` 包含定义、原始规则、单位、规则缺口和出处。 |
| `kb_create` | 接受稳定的 `conceptCode`、`label`、`englishName`、`definition`、`valueType`、`unit`、`ruleText`、`source`，可选 `crfTable`、`aliases` 和 `gaps`。`source` 必填文档名及位置，可加文件 SHA-256。原子提交后立即可查。同编码同内容重试返回 `already_exists`，同编码不同内容返回 `conflict`。 |

用户明确要求维护时，Agent 才调用 `kb_create`。缺少稳定编码、规则出处或遇到多条候选时，由 Kady 的 `interview` 让用户在聊天中确认。服务将新内容的来源标成 `submitted_by_agent`，调用方应在答复中呈现来源状态。已核验种子则标成 `verified_against_workbook`。

示例问句命中 `sym_cough_duration`（概念 ID `2097222564`）。该字段从主诉或现病史中取咳嗽或咳喘后的时间量，目标单位为月。引用「慢阻肺CRF量表」`B57:H57`。原表未给出天、周、年换算到月的细则，也未确定遇到多个时长或未记录时如何取值。

## 让 Agent 写入知识

使用写入令牌连接 `clinical-kb`，在 Kady 新对话中粘贴下方提示词。`kb_create` 每次接收一个 CRF 字段，在同一事务中写入 `VOCABULARY`、`CONCEPT`、`CONCEPT_SYNONYM` 和 `CRF_FIELD_RULE`。标准概念映射由单独的审核和导入流程维护。

### 单条写入

将方括号中的内容替换为实际字段与出处。

demo:请从user_data/慢阻肺CRF量表（含提取规则）疑问错误标注.xlsx. 的「慢阻肺CRF量表」字段所属表格为症状表，字段名称和规则列按一对写入专病知识库，如果存在空值则不处理。按原字段编码调用 kb_search 查重，确认资料齐全后用 kb_create 逐条写入，再按编码读回核对单位、规则和出处。信息不明确或同编码有差异时，用 interview 集中确认。

```text
请将 [文件名或附件] 中 [工作表和行号] 的「[字段名或字段编码]」作为新词条实际写入专病知识库。

1. 用表内原有字段编码填 conceptCode，中文原名填 label，所属表填 crfTable。根据来源填写 englishName、definition、valueType 和 unit。valueType 从 number、integer、text、boolean、date、coded 中选择。字段明确无单位时填 null。ruleText 保留原始提取规则、否定词和适用条件。换算、缺失值等原表未定义的内容写入 gaps。source.document 填文件名，source.locator 填实际工作表和单元格范围。只提交字段知识。
2. 调用 mcp__clinical_kb__kb_search 按原字段编码查重，本步省略 crfTable。以返回的 conceptCode 确认是否为同一字段。编码相同且内容一致时直接报告已存在。编码相同但规则、单位、所属表或出处有差异时列为冲突。编码、必填信息、来源或候选有歧义时用 interview 询问我。
3. 字段确认是新的且资料齐全时，调用 mcp__clinical_kb__kb_create 写入。同编码的冲突交由我确认后续处理。
4. 写入后用 mcp__clinical_kb__kb_search 按编码读回，核对字段编码、所属表、规则、单位和出处。返回实际状态、概念 ID 和出处。调用超时时先读回确认提交结果。
```

例如将字段指定为「咳嗽_时长」，来源指定为「慢阻肺CRF量表」`B57:H57`。读回时应核对 `sym_cough_duration`、所属表「症状表」和单位「月」。第 59 行「咳嗽_加重时长」使用独立的字段编码。

### 批量导入症状表

对应工作簿在项目的 `user_data/` 中时，可直接使用下方提示词。也可以将路径改为本次上传的工作簿。

```text
请读取 user_data/慢阻肺CRF量表（含提取规则）_疑问错误标注.xlsx 的「慢阻肺CRF量表」工作表，将所属表格为「症状表」且提取规则非空的字段实际写入专病知识库。

1. 每个原字段编码对应一条词条。同一行的字段名称与提取规则成对提取，保留原始字段编码、规则、值类型、单位与出处。空规则行跳过。来源的同一编码有不同规则时，记下相关行号并列为冲突。
2. 按编码调用 mcp__clinical_kb__kb_search 查重，本步省略 crfTable，以返回的 conceptCode 判断是否为同一字段。完全一致的词条记为已存在。已有内容有差异、必填信息不全或出处不明的行，集中用 interview 确认。其他符合条件的新字段可以继续导入。
3. 对每个新字段调用一次 mcp__clinical_kb__kb_create。填写 conceptCode、label、englishName、definition、valueType、unit、ruleText 和 source，将 crfTable 填为「症状表」。字段明确无单位时，unit 填 null。source.document 写文件名，source.locator 写该行的工作表及实际单元格范围。原表未规定的取数条件写入 gaps。只提交字段定义与规则。
4. 每条写入后按编码读回，核对规则、单位和出处。汇总已新建且核验通过、已存在、跳过、冲突或待确认、失败的数量。冲突和失败项列出字段编码、原始行号和原因。调用超时时先用字段编码查回，再根据实际结果决定是否重试。
```

如果 Agent 只能检索，检查连接器是否使用 `${KADY_KB_TOKEN}`，并确认新对话能看到 `kb_create`。

### 导入其他临床知识

其他病种的量表字段、检验取数规则和字段字典可复用**一字段一条规则**模板。指南推荐、临床判定规则和标准概念映射适合先用**审核草稿**模板。患者记录走临床数据接口。

#### 一字段一条规则模板

```text
请阅读 [资料名及范围]，将 [目标字段或字段表] 中有出处的字段定义与取数规则实际写入专病知识库。按一个稳定字段编码对应一个词条处理。

1. 按原资料填写 conceptCode、label、englishName、definition、valueType、unit、ruleText 和 source。已知归属表时填写 crfTable。valueType 选 number、integer、text、boolean、date 或 coded，明确无单位时用 null。source.document 写原始文档名，source.locator 写工作表和单元格范围，或章节和段落。保留原文规定的筛选、排序及取值条件。来源未定义的边界写入 gaps。
2. 用 mcp__clinical_kb__kb_search 按原字段编码查重，查重时省略 crfTable，并核对返回的 conceptCode。相同编码且内容一致记为已存在。编码、单位、规则或出处有歧义时，用 interview 集中确认。只处理有可核查来源的字段规则。
3. 对每条符合条件的新词条调用一次 mcp__clinical_kb__kb_create。写入后用同一编码读回，核对规则、值类型、单位、出处，并报告概念 ID。把结果汇总为新建且核验通过、已存在、待确认和失败。
```

#### 审核草稿模板

```text
请阅读 [指南、判定规则或映射资料] 的 [版本和章节]，输出供审核的导入草稿。当前任务只生成草稿。

1. 指南推荐或判定规则逐条列出适用人群、条件、例外、原文、版本、证据等级和出处。资料未提供的项标为待确认。
2. OMOP 映射逐条列出来源词汇与编码、目标术语、已核实的目标 concept_id、词汇版本和映射依据。缺少目标证据的记录标记为待审核。
3. 将需要独立结构的推荐、临床判定和标准映射交给对应审核流程。若资料中另外包含可独立入库的字段定义与取数规则，列为候选，等我明确要求写入后再使用字段导入模板。
```

#### 导入模板测试样例

下面两个对象来自模拟资料，分别演示数值型检验字段和无单位的布尔字段。每个对象分别作为一次 `kb_create` 调用的参数。

```json
[
  {
    "conceptCode": "demo_followup_fpg_latest",
    "label": "最近一次空腹血糖结果",
    "englishName": "Most recent fasting plasma glucose result",
    "crfTable": "糖尿病随访检验表",
    "aliases": ["最近一次空腹血糖"],
    "definition": "本次随访表记录的最近一次空腹血糖报告数值。",
    "valueType": "number",
    "unit": "mmol/L",
    "ruleText": "在本次随访的空腹血糖报告中，按采样时间取最近一条单位为 mmol/L 的数值。",
    "gaps": ["缺少采样时间时的处理规则未定义。"],
    "source": {"document": "模拟糖尿病随访字段说明.md", "locator": "检验表 / 字段 1"}
  },
  {
    "conceptCode": "demo_preop_allergy_documented",
    "label": "是否填写过敏史",
    "englishName": "Allergy history documented",
    "crfTable": "术前核对表",
    "aliases": ["过敏史填写状态"],
    "definition": "标记术前核对表的过敏史栏填写状态。",
    "valueType": "boolean",
    "unit": null,
    "ruleText": "过敏史栏填写时记录 true，空栏时记录 false。",
    "gaps": ["仅填写占位符时的处理规则未定义。"],
    "source": {"document": "模拟术前核对字段说明.md", "locator": "核对表 / 字段 2"}
  }
]
```

以上两条样例已在临时数据库通过 MCP 接口测试。两条均成功新建，可以按编码和别名读回。重复提交返回 `already_exists`，同编码不同规则返回 `conflict`。带指南推荐、标准概念映射或患者记录字段的参数按写入接口的字段约束被拒绝。

## OHDSI CDM 5.5 兼容层

CDM 5.5 可以给「咳嗽_时长」分配本地概念编码并登记别名。`CONCEPT_RELATIONSHIP` 表达概念之间的关系，`CONCEPT_METADATA` 的字段用于概念类别和代码复用状态。工作表的取数说明、规则缺口和单元格出处用本地 `CRF_FIELD_RULE` 表达，通过 `concept_id` 与术语关联。即便将“月”关联到标准单位，也仍需另行定义天、周、年换算规则。 [CDM 5.5 词汇表](https://ohdsi.github.io/CommonDataModel/cdm55.html#vocabulary-tables) · [OHDSI 自定义概念约定](https://ohdsi.github.io/CommonDataModel/customConcepts.html)

知识库服务在 SQLite 中建立该文档段落列出的 15 张 OMOP 实体表，以及本地 `CRF_FIELD_RULE`。其中 `COHORT` 和 `COHORT_DEFINITION` 在 OMOP 中属于 RESULTS schema，这里放在同一个 SQLite 文件中。既有数据库重新打开时会自动补齐缺少的表。PyCharm 刷新连接后可在 **Tables** 查看。 [OMOP CDM 5.5 词汇表](https://ohdsi.github.io/CommonDataModel/cdm55.html#vocabulary-tables) · [队列表定义](https://ohdsi.github.io/CommonDataModel/cdm55.html#cohort)

| SQLite 实体表 | 内容 |
| --- | --- |
| `VOCABULARY` | 本地词汇 `KADY_CRF`。导出时根据词汇内容计算版本号。 |
| `CONCEPT` | 本地 CRF 词条，概念 ID 大于 `2000000000`，`standard_concept` 为 `NULL`，引用目标词表中的 `Observation` 域和 `Undefined` 类。 |
| `CONCEPT_SYNONYM` | 英文名和中文名、别名。英语 ID 为 `4180186`。中文 ID 可用 `KADY_KB_ZH_LANGUAGE_CONCEPT_ID` 绑定至目标词汇版本，缺省语言 ID 为 `0`。 [OHDSI 英语语言 ID](https://github.com/OHDSI/Vocabulary-v5.0/blob/master/working/generic_update.sql) |
| `DOMAIN`、`CONCEPT_CLASS`、`RELATIONSHIP` | 维护域、概念类别和关系类型定义。 |
| `CONCEPT_RELATIONSHIP`、`CONCEPT_ANCESTOR` | 保存概念关系和祖先关系。 |
| `SOURCE_TO_CONCEPT_MAP` | 保存来源编码到标准概念的映射。 |
| `DRUG_STRENGTH`、`PACK_CONTENT` | 保存药品剂量信息和包装组成。 |
| `CONCEPT_METADATA`、`CONCEPT_RELATIONSHIP_METADATA` | 保存概念类别、复用状态和映射元数据。 |
| `COHORT`、`COHORT_DEFINITION` | 保存队列成员和队列定义。 |
| `CRF_FIELD_RULE` | 本地扩展实体表，以 `concept_id` 引用 `CONCEPT`，保存所属表、中文显示名、字段定义、值类型、目标单位、提取规则、规则缺口和来源位置。每个 CRF 概念当前对应一条规则。 |

`kb_create` 在同一个事务写入概念、同义词和提取规则，`kb_search` 按 `concept_id` 关联查询。补齐表结构时只建表。标准术语和映射记录由后续词汇导入或审核流程维护。

### 从 `entries` 升级

在保留原 `KADY_KB_TOKEN` 的终端停止旧进程，再启动本版服务。服务确认监听地址可用后，从 SQLite 保存可单独打开的快照到数据库旁的 `backups/`，并检查其完整性。随后在同一个事务中替换旧视图，迁移 `entries` 的概念 ID、名称、规则、出处和发布信息，逐条读回核验，最后删除 `entry_terms` 和 `entries`。出错时回滚迁移，快照可用于恢复。

升级时根据已核验的来源给「咳嗽_时长」种子补上 `crf_table = '症状表'`。其余旧条目保留来源记录的表信息，原先未填写的可以不带表限定检索。导出命令读取迁移后的实体表。

### 查询「咳嗽_时长」

查询症状表下的「咳嗽_时长」时，可调用 `kb_search` 并传入 `{"query":"咳嗽_时长有什么表现？","crfTable":"症状表"}`。在 PyCharm 的 SQL Console 也可查看关联结果。

```sql
SELECT c.concept_id, c.concept_code, c.standard_concept,
       r.label, r.crf_table, r.unit, r.rule_text, r.gaps_json, r.source_locator
FROM CONCEPT AS c
JOIN CRF_FIELD_RULE AS r USING (concept_id)
WHERE c.vocabulary_id = 'KADY_CRF'
  AND c.concept_code = 'sym_cough_duration'
  AND r.crf_table = '症状表';
```

结果对应本地概念 `2097222564` 和 CRF `B57:H57`。原规则从主诉或现病史提取咳嗽或咳喘之后的时间量，目标单位为月。原表未定义天、周、年如何换算为月，也未定义多个时长、否认或未记录时如何处理，查询结果会返回这些缺口。

`kb_search` 支持按字段编码、名称或 `CONCEPT_SYNONYM` 中的别名匹配，也会把「咳嗽持续多久」「咳嗽持续了多长时间」「如何记录咳嗽的持续时间」这类问句归一为「咳嗽时长」。归一时保留「加重」等限定词，所以「咳嗽加重持续多久」会查自己的字段。当前识别范围是已登记的别名和已支持的问句形式。查不到时返回 `not_found`，有多个候选时返回 `ambiguous`。

```bash
# 导出四个词汇实体表到 JSON，或输出 CSV 到一个尚不存在的目录
node knowledge-service/cli.mjs export-omop
npm run export:omop --prefix knowledge-service -- /tmp/kady-crf-export
```

CSV 使用 UTF-8、逗号分隔和表头。导入现有 OMOP 时，先检查目标词表包含所需的域、类、语言和 `concept_id = 0` 引用，并核对 `KADY_CRF` 及本地概念 ID 是否与目标已有自定义词汇冲突。下载自 Athena 的完整词汇、标准概念映射及患者事件表由目标 CDM 管理。首期范围是词汇表子集导出和本地字段问答。

## 长期存储设计

当前数据库存储术语和规则。患者、就诊、诊断、检验和用药具有不同的数据粒度、必填项和关联关系，后续应使用 OMOP 的分域表，使按患者、就诊、时间窗和标准概念查询时能使用明确的字段、关系和索引。专病提取规则也需要独立版本，以便按研究使用过的规则复现结果。 [OMOP CDM 5.5 临床数据表](https://ohdsi.github.io/CommonDataModel/cdm55.html#clinical-data-tables)

| 数据 | 长期存储位置 | 「咳嗽_时长」对应内容 |
| --- | --- | --- |
| 专病字段和提取规则 | 当前在 `CONCEPT` 和 `CRF_FIELD_RULE` 中按概念 ID 关联。需要规则修订时，可进一步增加独立版本记录。 | 症状表字段 `sym_cough_duration`、提取规则、目标单位「月」和 `B57:H57`。 |
| 术语和映射 | OMOP 词汇表中的 `VOCABULARY`、`CONCEPT`、`CONCEPT_SYNONYM` 和 `CONCEPT_RELATIONSHIP`，按词汇版本管理经过核验的映射。 | `KADY_CRF` 中的本地概念 `2097222564`。标准概念映射需要核验后登记。 |
| 患者临床事实 | 临床库的 `PERSON`、`VISIT_OCCURRENCE`、`CONDITION_OCCURRENCE`、`OBSERVATION`、`MEASUREMENT`、`DRUG_EXPOSURE` 等分域表。 | 某患者在某次就诊报告「咳嗽 3 个月」属于一条临床事实，具体落表取决于核验后的目标概念域。 |
| 原始数据与处理记录 | ODS 保存原始记录。ETL 的追溯记录关联来源记录、规则版本、目标表及目标记录 ID。 | 可追溯本次提取来自哪条主诉或现病史、采用哪个版本的规则。 |

如果审核后的目标概念属于 Observation 域，上例可写入 `OBSERVATION`，用 `value_as_number` 记录 `3`，用 `unit_concept_id` 引用核验后的单位概念，并在 `observation_source_concept_id` 保留本地来源概念 ID。标准分析字段使用核验后的标准概念。遇到「咳嗽两周」且月换算规则仍未定义时，保留原始值和单位供复核。 [OBSERVATION 字段规范](https://ohdsi.github.io/CommonDataModel/cdm55.html#observation) · [OHDSI 自定义概念约定](https://ohdsi.github.io/CommonDataModel/customConcepts.html)

接入患者数据时，由 ODS 到 OMOP 的 ETL 按核验后的映射落表，并记录所用规则版本。Agent 通过知识库 MCP 查询规则或维护词条，临床数据的查询由独立授权的接口提供。

## 选型取舍

- **SQLite + 独立 MCP**适合一个词条起步，也可直接接着增加 CRF 字段。开销小，两个会话共享数据，持久化和去重放在同一事务。代价是目前采用单个写库，首期的维护入口是 MCP，人工批量编辑界面、多租户和集群访问需要后续建设。
- **字段编码和别名检索**容易验证精确命中，可区分「咳嗽_时长」和「咳嗽_加重时长」。自由表述覆盖有限，Agent 可先提取字段名再查，多条命中时交给用户消歧。
- **直接发布**降低录入摩擦，已发布词条的编码和内容可追溯。Agent 提交的出处真实性仍需使用者核查，目前同一编码只能新建一次，正式更正可扩展为显式版本修订。
- **OMOP 词汇实体表加本地规则表**让词汇能进入 CDM 集成流程，也能保留原表的提取语义。CDM 消费者可以通过知识服务取得规则，标准概念映射需要具体验证。

## 验证

运行 `npm test --prefix knowledge-service`。测试覆盖 MCP 鉴权、只读凭据、CRF 所属表限定、相邻字段区分、跨连接写入、幂等、重启持久化、旧库里的词条和 ID 保留，以及 CDM 词汇表导出。
