// From server/: node --import tsx scripts/local-preview-acceptance.mjs (web dev server running).
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

export async function exercisePreview({ config, resource, workspace, verify, secret }) {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "local-preview-check-"));
  const web = "http://127.0.0.1:3000";
  Object.assign(process.env, { KADY_PROJECTS_ROOT: path.join(root, "projects"), PI_CODING_AGENT_DIR: path.join(root, "agent"),
    KADY_PREVIEW_ADAPTERS: path.join(root, "adapters.json"), KADY_REQUIRE_AUTH: "0", LOG_LEVEL: "silent" });
  fs.writeFileSync(process.env.KADY_PREVIEW_ADAPTERS, JSON.stringify([config]));
  let api, browser;
  try {
    const { buildApp } = await import("../src/index.ts");
    const { createProject, resolvePaths } = await import("../src/projects.ts");
    const { localPreviewTools, withPreviewOrigin } = await import("../src/agent/local-preview.ts");
    const { SessionManager } = await import("@earendil-works/pi-coding-agent");
    createProject({ name: "Preview acceptance", projectId: config.project });
    const paths = resolvePaths(config.project);
    fs.writeFileSync(path.join(paths.sandbox, "ordinary.html"), '<h1>Isolated report</h1><script>parent.parent.postMessage({reportTitle:document.querySelector("h1").textContent},"*")</script>');
    const task = SessionManager.create(paths.sandbox, paths.sessionsDir);
    const taskName = "Open the local preview";
    task.appendMessage({role:"user",content:taskName,timestamp:Date.now()});
    const tool = localPreviewTools(config.project, () => task.getSessionId(), workspace || paths.sandbox)[0];
    const args = { adapter:config.id, resource };
    const output = await withPreviewOrigin(web, () => tool.execute("call-1", args));
    const action = JSON.parse(output.content[0].text);
    const assistant = { role:"assistant",api:"openai-completions",provider:"ollama",model:"fixture",timestamp:Date.now(),
      usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}} };
    task.appendMessage({...assistant,stopReason:"toolUse",content:[{type:"toolCall",id:"call-1",name:tool.name,arguments:args}]});
    task.appendMessage({role:"toolResult",toolName:tool.name,toolCallId:"call-1",...output,isError:false,timestamp:Date.now()});
    task.appendMessage({...assistant,stopReason:"stop",content:[{type:"text",text:"The preview is ready."}]});
    if (secret) assert.ok(!fs.readFileSync(task.getSessionFile(),"utf8").includes(secret));
    api = await buildApp();
    browser = await chromium.launch({executablePath:process.env.CHROME_PATH,headless:true});
    const client = await browser.newContext({viewport:{width:1440,height:900},locale:"en-US"});
    await client.route(/(?:localhost|127\.0\.0\.1):8000\/|\/api\/kady\//, async route => {
      const req=route.request(), url=new URL(req.url()), headers={host:"127.0.0.1",origin:web,"x-project-id":req.headers()["x-project-id"] || "default"};
      if(req.headers()["content-type"]) headers["content-type"]=req.headers()["content-type"];
      const result=await api.inject({method:req.method(),url:url.pathname.replace(/^\/api\/kady/,"")+url.search,headers,payload:req.postData() ?? undefined});
      await route.fulfill({status:result.statusCode,contentType:result.headers["content-type"],body:result.rawPayload});
    });
    const page=await client.newPage();
    await page.goto(web);
    await page.getByRole("button",{name:/^(Open project|打开项目) Preview acceptance$/i}).click();
    await page.getByText(taskName,{exact:true}).first().click();
    const open=page.getByRole("button",{name:new RegExp("(Open preview|打开预览).*"+action.title)});
    await open.click();
    const frame=page.frameLocator('iframe[title="'+action.title+'"]');
    await verify(page,frame,async()=>{
      await page.getByRole("button",{name:/^(Close preview|关闭预览)$/}).click();
      await open.click();
    });
    await page.getByRole("button",{name:/^(Close preview|关闭预览)$/}).click();
    await page.evaluate(() => window.addEventListener("message", event => {
      if (event.origin === "null" && event.data?.reportTitle === "Isolated report")
        document.documentElement.dataset.reportRendered = "true";
    }));
    await page.getByText("ordinary.html",{exact:true}).first().click();
    const report = page.locator("iframe[srcdoc]").first();
    await report.waitFor();
    assert.equal(await report.getAttribute("sandbox"),"allow-scripts");
    assert.ok((await report.getAttribute("srcdoc")).includes("Isolated report"));
    await page.waitForFunction(() => document.documentElement.dataset.reportRendered === "true");
    if(secret) for(const file of fs.readdirSync(root,{recursive:true})) {
      const name=path.join(root,file);
      if (/\.jsonl$|\.log$/.test(file) && fs.statSync(name).isFile()) assert.ok(!fs.readFileSync(name,"utf8").includes(secret));
    }
  } finally {
    await browser?.close();
    await api?.close();
    fs.rmSync(root,{recursive:true,force:true});
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"preview-fixture-"));
  const token=randomUUID();
  let saved="";
  const app=http.createServer(async(req,res)=>{
    if(req.url==="/save" && req.method==="POST") {
      let text=""; for await(const chunk of req) text+=chunk;
      saved=text; res.end("saved"); return;
    }
    res.setHeader("Content-Type","text/html");
    res.end('<textarea></textarea><button>Save</button><output></output><script>document.querySelector("textarea").value='+JSON.stringify(saved)+';document.querySelector("button").onclick=async()=>{await fetch("/save",{method:"POST",body:document.querySelector("textarea").value});document.querySelector("output").textContent="saved"}</script>');
  });
  try {
    app.listen(0,"127.0.0.1"); await once(app,"listening");
    const url="http://127.0.0.1:"+app.address().port+"/edit/item?q=one#"+token;
    const adapter=path.join(dir,"adapter.cjs");
    fs.writeFileSync(adapter,'let input="";process.stdin.on("data",d=>input+=d);process.stdin.on("end",()=>{if(JSON.parse(input).platform_origin!=="http://127.0.0.1:3000")process.exit(1);console.log('+JSON.stringify(JSON.stringify({open_preview:{kind:"local_url",url,title:"Sample editor"}}))+')})');
    await exercisePreview({config:{project:"sample",id:"sample",description:"Sample editor",executable:process.execPath,args:[adapter]},resource:"item",secret:token,
      verify:async(page,frame,reopen)=>{
        await frame.locator("textarea").waitFor();
        assert.ok(await frame.locator("body").evaluate((_,expected)=>location.href===expected,url));
        await frame.locator("textarea").fill("preserved sample");
        await frame.getByRole("button",{name:"Save"}).click();
        await frame.getByText("saved",{exact:true}).waitFor();
        await reopen();
        assert.equal(await frame.locator("textarea").inputValue(),"preserved sample");
      }});
    console.log("Verified chat action, path/query/fragment, save, reopen, and credential exclusion from recorded history.");
  } finally { app.closeAllConnections(); app.close(); fs.rmSync(dir,{recursive:true,force:true}); }
}
