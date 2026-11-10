// SPDX-License-Identifier: AGPL-3.0-only
// Mold Making's real browser/worker/export smoke test. The generated fixture
// is deliberately small so an upstream PR can exercise this plugin in CI
// without depending on an external scan, STEP server, or preinstalled slicer.
//
// Run after npm run build and with a dev server:
//   node plugins/mold-making/scripts/e2e-mold-making.mjs
// In npm run e2e:ci, scripts/e2e-ci.mjs supplies APP_URL and OUT_DIR.
import {fileURLToPath} from 'node:url'
import {check,fail,finish,launchApp,loadScan,shotPath,sleep} from '../../../scripts/e2e-lib.mjs'

const fixture=fileURLToPath(new URL('../fixtures/cube-10mm.stl',import.meta.url))
const {browser,page,consoleErrors}=await launchApp({
  width:1500,height:1050,protocolTimeout:600_000,
})
page.on('dialog',dialog=>dialog.accept())

const timeout=180_000
const waitForBuild=async(label)=>{
  // A worker failure must not masquerade as a test that just timed out.
  await page.waitForFunction(
    ()=>!!document.querySelector('[data-test="mold-result"]')||
       !!document.querySelector('[data-test="mold-error"]'),
    {timeout},
  )
  const error=await page.$eval('[data-test="mold-error"]',e=>e.textContent).catch(()=>null)
  if(error)throw new Error(label+': '+error)
  const state=await page.evaluate(()=>{
    const root=document.querySelector('[data-test="mold-result"]')
    const rows=root?.querySelectorAll('[data-test^="mold-part-row-"]')??[]
    return {
      count:rows.length,
      exportable:!!root?.textContent.includes('Exportable solids'),
      previewOnly:!!root?.textContent.includes('Preview-only solids'),
    }
  })
  if(!state.exportable)throw new Error(label+': generation was preview-only')
  return state
}

/** Exercise real buttons and capture the exact Blob they hand to the browser,
 * without writing into CI's downloads folder or invoking Chrome's save modal.
 * The hook lives only during this click and is fully restored afterward.
 */
const captureExport=async(selector)=>page.evaluate(async(selector)=>{
  const button=document.querySelector(selector)
  if(!(button instanceof HTMLButtonElement)||button.disabled)
    throw new Error('Missing or disabled export button: '+selector)
  let blob=null,name=''
  const create=URL.createObjectURL
  const click=HTMLAnchorElement.prototype.click
  URL.createObjectURL=(file)=>{blob=file;return 'blob:mold-e2e-capture'}
  HTMLAnchorElement.prototype.click=function(){
    if(this.download){name=this.download;return}
    return click.call(this)
  }
  try{
    button.click()
    // saveBuilt calls saveFile synchronously, but the filename/blob still
    // round-trip through the same renderer and real export builder.
    await Promise.resolve()
    if(!name||!(blob instanceof Blob))throw new Error('Export made no file: '+selector)
    return {
      name,size:blob.size,type:blob.type,
      signature:Array.from(new Uint8Array(await blob.slice(0,5).arrayBuffer())),
    }
  }finally{
    URL.createObjectURL=create
    HTMLAnchorElement.prototype.click=click
  }
},selector)

try{
  await loadScan(page,fixture,{
    inputSelector:'[data-test="start-scan"] input[type="file"]',
    timeout:120_000,settle:300,
  })
  const original=await page.evaluate(async()=>{
    const {useStore}=await import('/src/state/store.ts')
    return useStore.getState().fileName
  })
  check(original==='cube-10mm.stl','committed 10 mm master loads into the app')

  await page.click('[data-test="workspace-mold-making"]')
  await page.waitForSelector('[data-test="mold-making-panel"]')
  check((await page.$$('[role="tab"][data-test^="mold-tab-"]')).length===4,
    'four workflow destinations render as real tabs')
  const visual=await page.evaluate(()=>{
    const strip=document.querySelector('[data-test="mold-workflow-tabs"]')
    const selected=strip?.querySelector('[aria-selected="true"]')
    const rest=strip?.querySelector('[aria-selected="false"]')
    const panel=document.querySelector('.mold-workflow-content')
    return {
      selected:selected?.id,
      strip:!!strip&&!!panel,
      selectedBackground:selected?getComputedStyle(selected).backgroundColor:'',
      restBackground:rest?getComputedStyle(rest).backgroundColor:'',
    }
  })
  check(visual.strip&&visual.selected==='mold-tab-setup',
    'connected tab strip starts on Model & size')
  check(visual.selectedBackground!==visual.restBackground,
    'selected tab is visibly distinct from inactive navigation')
  // Live preference changes must convert BOTH text labels and length field values.
  // Server-side static markup uses Zustand's initial snapshot, so this belongs
  // in the browser smoke test rather than a server-rendered component test.
  await page.evaluate(async()=>{
    const {usePrefs}=await import('/src/state/prefsStore.ts')
    usePrefs.getState().setUnits('in')
  })
  await page.waitForFunction(()=>document.querySelector('[data-test="mold-making-panel"]')
    ?.textContent?.includes('Tool dimensions (in)'),{timeout:10_000})
  const inchWidth=await page.$eval('[data-test="mold-repair-hole-size"]',e=>Number(e.value))
  check(Math.abs(inchWidth-2/25.4)<0.00001,'mesh repair length input converts to inches')
  await page.evaluate(async()=>{
    const {usePrefs}=await import('/src/state/prefsStore.ts')
    usePrefs.getState().setUnits('mm')
  })
  await page.waitForFunction(()=>document.querySelector('[data-test="mold-making-panel"]')
    ?.textContent?.includes('Tool dimensions (mm)'),{timeout:10_000})
  const metricWidth=await page.$eval('[data-test="mold-repair-hole-size"]',e=>Number(e.value))
  check(Math.abs(metricWidth-2)<1e-8,'mesh repair input returns to millimetres')


  await page.click('[data-test="mold-generate"]')
  const rigid=await waitForBuild('two-part direct rigid mold')
  check(rigid.count>=2,'rigid mold makes at least two independent components')
  check(rigid.exportable&&!rigid.previewOnly,'rigid mold results are exportable')
  check((await page.$('[data-test="mold-tab-review"][aria-selected="true"]'))!==null,
    'Inspect tab opens automatically after generation')
  const stl=await captureExport('[data-test="mold-export-part-1"]')
  check(stl.name.endsWith('.stl')&&stl.size>84,
    'individual mold STL downloads a nonempty mesh')
  const mf=await captureExport('[data-test="mold-export-3mf"]')
  check(mf.name.endsWith('.3mf')&&mf.size>100&&mf.signature[0]===0x50&&mf.signature[1]===0x4b,
    'multipart 3MF downloads a nonempty ZIP container')

  // Display-only controls must neither discard the generation nor change
  // export byte sizes. This also exercises the part-list React integration.
  await page.click('[data-test="mold-part-visible-0"]')
  check((await page.$('[data-test="mold-part-visible-0"][aria-pressed="false"]'))!==null,
    'individual mold halves can be hidden')
  await page.click('[data-test="mold-part-isolate-0"]')
  check((await page.$('[data-test="mold-part-isolate-0"][aria-pressed="true"]'))!==null,
    'a single mold half can be isolated')
  const stillExported=await captureExport('[data-test="mold-export-part-1"]')
  check(stillExported.size===stl.size,
    'part visibility and isolation do not alter STL geometry')

  // The CAD reference handoff used to replace the original imported scan,
  // thereby destroying the mold result and all other generated pieces.
  // Verify the real workspace switch preserves both instead.
  await page.click('[data-test="mold-edit-cad-0"]')
  await page.waitForFunction(async()=>{
    const {useShell}=await import('/src/state/shellStore.ts')
    return useShell.getState().workspace==='reverse'
  },{timeout:30_000})
  const preserved=await page.evaluate(async()=>{
    const {useStore}=await import('/src/state/store.ts')
    return useStore.getState().fileName
  })
  check(preserved===original,'CAD reference does not replace the original master')
  await page.evaluate(async()=>{
    const {useShell}=await import('/src/state/shellStore.ts')
    useShell.getState().setWorkspace('mold-making')
  })
  await page.waitForSelector('[data-test="mold-result"]')
  check((await page.$$('[data-test^="mold-part-row-"]')).length===rigid.count,
    'CAD reference handoff preserves all generated mold pieces')
  await page.screenshot({path:shotPath('mold-making-rigid.png')})

  // Change modes through the real toolbar, not a replacement scan. Rebuild
  // the silicone containment to prove the mode switch and worker roundtrip.
  await page.click('[data-test="mold-tab-setup"]')
  await page.evaluate(()=>{
    const option=Array.from(document.querySelectorAll('[aria-label="Tooling method"] button'))
      .find(b=>b.textContent.includes('Silicone'))
    if(!(option instanceof HTMLButtonElement))throw new Error('Silicone box mode unavailable')
    option.click()
  })
  // Wait until the previous rigid result is really invalidated. Otherwise
  // waitForBuild could accidentally pass on the prior mold's DOM result.
  await page.waitForFunction(async()=>{
    const {useMold}=await import('/plugins/mold-making/state/moldStore.ts')
    return useMold.getState().mode==='silicone-box'&&
      !document.querySelector('[data-test="mold-result"]')
  },{timeout:20_000})
  await page.click('[data-test="mold-generate"]')
  const box=await waitForBuild('two-part silicone containment')
  check(box.count>=2,'silicone box generates separate printable sections')
  const net=await page.$eval('[data-test="mold-silicone-mix-volume"]',e=>e.textContent).catch(()=>null)
  check(!!net&&net.includes('Silicone to pour')&&!net.includes('Cannot determine'),
    'silicone-box estimate subtracts the known closed master displacement')
  const boxExport=await captureExport('[data-test="mold-export-3mf"]')
  check(boxExport.name.endsWith('.3mf')&&boxExport.size>100,
    'silicone box exports a multipart 3MF')
  await page.screenshot({path:shotPath('mold-making-silicone.png')})
}catch(error){
  fail(error.stack??error.message)
}
await finish(browser,consoleErrors)
