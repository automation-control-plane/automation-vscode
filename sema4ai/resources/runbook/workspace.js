(() => {
  'use strict';
  const vscode = acquireVsCodeApi();
  const app = document.getElementById('app');
  let state, filter = '', tab = 'overview';
  const previous = vscode.getState();
  if (previous && typeof previous.filter === 'string') filter = previous.filter;
  const send = message => vscode.postMessage(message);
  function el(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = String(text); return node; }
  function icon(name) { const node = el('span', 'codicon codicon-' + name); node.setAttribute('aria-hidden', 'true'); return node; }
  function button(label, action, options = {}) { const node = el('button', options.primary ? 'button primary' : 'button', label); if (options.icon) node.prepend(icon(options.icon)); node.type = 'button'; node.disabled = !!state?.busy || !!options.disabled; if (options.reason) node.title = options.reason; node.onclick = () => send({op:'action', action, ...(options.target ? {target:options.target} : {})}); return node; }
  function nav(label, route, name) { const node = el('button', 'text-button', label); if (name) node.prepend(icon(name)); node.onclick = () => send({op:'navigate', route}); return node; }
  function section(title, description) { const node = el('section', 'section'); node.append(el('h2', '', title)); if (description) node.append(el('p','muted',description)); return node; }
  function actions(...nodes) { const row = el('div','actions'); row.append(...nodes); return row; }
  function note(title, text, kind = 'info') { const node = el('div','notice ' + kind); node.append(icon(kind === 'error' ? 'error' : kind === 'success' ? 'pass' : 'info'), el('div','notice-copy')); node.lastChild.append(el('strong','',title), el('p','',text)); return node; }
  function detail(label, value, monospace = false) { const row = el('div','detail'); const content=el('dd',monospace?'mono':'',value || 'Not configured'); if(monospace&&value) content.title=value; row.append(el('dt','',label),content); return row; }
  function empty(title, text, ...buttons) { const node = el('div','empty'); node.append(icon('package'), el('h2','',title),el('p','muted',text), actions(...buttons)); return node; }
  function render() {
    if (!state) return;
    app.replaceChildren();
    const selected = state.selected;
    const header = el('header','workspace-header');
    const eyebrow = el('div','eyebrow'); eyebrow.append(el('span','','AUTOMATION CONTROL PLANE'), el('span','section-name',state.title));
    const refresh = el('button','icon-button'); refresh.append(icon('refresh')); refresh.title = 'Refresh packages and status'; refresh.setAttribute('aria-label','Refresh packages and status'); refresh.onclick = () => send({op:'refresh'}); refresh.disabled=state.busy; eyebrow.append(refresh);
    const heading = state.route === 'settings' ? 'Make it your workspace' : state.route === 'runs' ? 'Run history' : state.route === 'inspectors' ? 'Inspect your application' : selected?.name || 'Your automation workspace';
    header.append(eyebrow, el('h1','',heading), el('p','subtitle', state.route === 'settings' ? 'Tooling, Python integration and workspace preferences' : selected ? selected.directory + '  ·  ' + selected.kind + ' Package' : 'Prepare a package, run with confidence, inspect the result.'));
    const journey = el('nav','journey'); journey.setAttribute('aria-label','Runbook workflow');
    for (const [label,route] of [['Prepare','packages'],['Run','runs'],['Inspect','inspectors']]) {
      const node = nav(label,route); node.prepend(icon(route === 'packages' ? 'circle-large-outline' : route === 'runs' ? 'play-circle' : 'search'));
      node.disabled = !!state.startup && state.startup.status !== 'ready';
      if (state.route === route || (route === 'packages' && state.route === 'environments')) {node.classList.add('current');node.setAttribute('aria-current','step');}
      journey.append(node);
    }
    header.append(journey); app.append(header);
    if (state.startup && state.startup.status !== 'ready') {
      const startup=state.startup;
      const status=note(startup.title,startup.message,startup.status==='failed'?'error':'info');
      status.setAttribute('role',startup.status==='failed'?'alert':'status');
      app.append(status);
      const controls=actions();
      if(startup.status==='failed') controls.append(button('Retry startup','retry-startup',{primary:true,icon:'refresh',reason:'Reload Window to retry startup. Existing environments and files are preserved.'}));
      controls.append(button('Diagnostic logs','diagnostics',{icon:'output'}),button('Open Settings','native-settings',{icon:'settings-gear'}));
      app.append(controls);
      if(startup.status==='failed') app.append(el('p','muted','Retry reloads this window. Correct the reported startup problem first; existing environments and files are preserved.'));
      if(state.route!=='settings') return;
    }
    if (state.error) app.append(note('Could not complete the operation',state.error,'error'));
    if (!state.trusted) app.append(note('Workspace trust required','Browsing is safe. Trust this workspace before resolving Python, running a package or opening an Inspector.'));
    if (state.busy) app.append(note('Working…','The requested operation is in progress. Existing package data is unchanged until its operation confirms success.'));
    const layout = el('div','workspace-layout');
    if (state.route !== 'settings') layout.append(contextRail());
    else layout.classList.add('without-rail');
    const content = el('main','workspace-main');
    if (state.route === 'packages') content.append(packagesView());
    else if (state.route === 'environments') content.append(environmentsView());
    else if (state.route === 'runs') content.append(runsView());
    else if (state.route === 'inspectors') content.append(inspectorsView());
    else if (state.route === 'settings') content.append(settingsView());
    else content.append(empty('Choose an Action or Robot package','Work Items are scoped to an Action package.yaml or Robot robot.yaml. Agent configuration does not create a Work Items authority.', nav('Choose a package','packages')));
    layout.append(content); app.append(layout);
  }
  function contextRail() {
    const rail=el('aside','context-rail'); rail.setAttribute('aria-label','Package context');
    const selected=state.selected;
    const label=el('label','rail-label','PACKAGES'); label.htmlFor='package-search'; rail.append(label);
    const search=el('input','package-search'); search.id='package-search'; search.type='search'; search.placeholder='Search packages…';search.value=filter;
    search.oninput=()=>{filter=search.value;vscode.setState({filter}); renderPackageList(list);};rail.append(search);
    const list=el('div','package-list');rail.append(list);renderPackageList(list);
    if (selected) {
      const context=section('Package context');const details=el('dl');details.append(detail('Type',selected.kind+' Package'),detail('Configuration',selected.manifest,true),detail('Directory',selected.directory,true));context.append(details);
      if (selected.version) context.append(el('span','badge','Version '+selected.version));rail.append(context);
      const prepare=section('Shortcuts');prepare.append(nav('Environment','environments','server-environment'),button('Work Items','work-items',{icon:'briefcase',disabled:selected.kind==='Agent',reason:'Work Items require an Action or Robot package'}),button('Open files','reveal',{icon:'files'}),button('Diagnostic logs','diagnostics',{icon:'output'}));rail.append(prepare);
    }
    return rail;
  }
  function renderPackageList(list) {
    list.replaceChildren();const packages=state.packages.filter(pkg=>(pkg.name+' '+pkg.directory+' '+pkg.kind).toLowerCase().includes(filter.toLowerCase()));
    if (!packages.length) list.append(el('p','muted',state.packages.length ? 'No matching packages.' : 'No packages found.'));
    for(const pkg of packages){const row=el('button','package-row'+(pkg.id===state.selected?.id?' selected':''));row.append(icon(pkg.kind==='Agent'?'person':'package'));const text=el('span');text.append(el('strong','',pkg.name),el('small','',pkg.kind+' · '+pkg.directory));row.append(text);row.title=pkg.directory;row.onclick=()=>send({op:'selectPackage',target:pkg.id});if(pkg.id===state.selected?.id)row.setAttribute('aria-current','true');list.append(row);}
    const add=button('Create a package','create-action',{icon:'add'});add.onclick=()=>{const menu=el('div','create-menu');menu.append(button('Action Package','create-action'),button('Robot Package','create-robot'),button('Agent Package…','create-agent'));add.replaceWith(menu);};list.append(add);
  }
  function packagesView(){
    const page=el('div');const pkg=state.selected;
    if(!pkg){page.append(empty('Start with a package','Create an Action for a callable Python workflow, or a Robot for a task-based automation. Existing packages appear when their folder is opened.',button('Create Action Package','create-action',{primary:true,icon:'add'}),button('Create Robot Package','create-robot',{icon:'package'})));return page;}
    const tabs=el('div','tabs');for(const [id,label] of [['overview','Overview'],['configuration','Configuration']]){const item=el('button',tab===id?'active':'',label);item.setAttribute('aria-pressed',String(tab===id));item.onclick=()=>{tab=id;render();};tabs.append(item);}tabs.append(button('Open '+pkg.manifest,'configure',{icon:'go-to-file'}));page.append(tabs);
    if(tab==='configuration'){
      const config=section('Package configuration','The manifest is the source of truth. Open it in the native editor for validated YAML, diagnostics and exact dependency pins.');
      config.append(actions(button('Edit '+pkg.manifest,'configure',{primary:true,icon:'edit'}),...(pkg.kind==='Robot'?[button('Edit environment dependencies','dependencies')]:[])));
      if(pkg.description)config.append(el('p','',pkg.description));config.append(dependencyTable(pkg.dependencies));page.append(config);
      if(pkg.kind==='Action')page.append(sectionActions('Local package export','Build a ZIP or inspect OpenAPI metadata. These operations stay local; nothing is published.',button('Build package ZIP','export',{icon:'package'}),button('OpenAPI metadata','metadata',{icon:'code'})));
      return page;
    }
    if(pkg.kind==='Agent')page.append(note('Agent tooling is a separate dependency','The package is discoverable and editable. Building or running an Agent requires an explicitly configured compatible Agent CLI; no compatible published acquisition is available.'));
    const prepare=section('Ready your next run',pkg.description || 'Keep package configuration, environment and input together before you run.');
    prepare.append(actions(nav('Review environment','environments','server-environment'),button('Prepare Work Items','work-items',{primary:true,icon:'briefcase',disabled:pkg.kind==='Agent'}),button('Open package terminal','terminal',{icon:'terminal',disabled:pkg.kind==='Agent'})));page.append(prepare);
    const runnable=section(pkg.kind==='Robot'?'Robot tasks':'Python Actions','Run and Debug use the existing package launchers and selected Work Item input. No run starts until you choose it.');
    if(!state.runnable.length)runnable.append(note('No runnable entry discovered',pkg.kind==='Agent'?'Use the existing Agent configuration and tooling commands from the package tree.':'Refresh after adding a task or Action. Check the package manifest and Python diagnostics if entries are missing.'));
    else{const table=el('table','data-table');const head=el('thead');const row=el('tr');for(const name of ['Name','Source','Actions'])row.append(el('th','',name));head.append(row);table.append(head);const body=el('tbody');for(const task of state.runnable){const row=el('tr');const name=el('td');name.append(el('strong','',task.name),el('small','muted',task.kind));const source=el('td','source-cell',task.source.split(/[\\/]/).pop());source.title=task.source;const controls=el('td');controls.append(actions(button('Run','run',{primary:true,icon:'play',target:task.id}),button('Debug','debug',{icon:'debug-alt',target:task.id}),...(task.kind==='Action'?[button('Inputs','action-inputs',{icon:'edit',target:task.id})]:[]),button('Source','source',{target:task.id})));row.append(name,source,controls);body.append(row);}table.append(body);runnable.append(table);}page.append(runnable);
    page.append(sectionActions('After the run','Inspect the actual output, files and logs. Work Item receipts and streamed run logs retain their own identities.',nav('Run history','runs','history'),nav('Open Inspectors','inspectors','search')));return page;
  }
  function dependencyTable(dependencies){const wrapper=el('div');if(!dependencies.length){wrapper.append(el('p','muted','Dependencies are defined by this package’s environment configuration. No resolved versions are inferred.'));return wrapper;}const table=el('table','data-table');const head=el('tr');head.append(el('th','','Source'),el('th','','Declared dependency'));const thead=el('thead');thead.append(head);table.append(thead);const body=el('tbody');for(const entry of dependencies){const row=el('tr');row.append(el('td','',entry.source),el('td','mono',entry.value));body.append(row);}table.append(body);wrapper.append(table);return wrapper;}
  function sectionActions(title,description,...buttons){const node=section(title,description);node.append(actions(...buttons));return node;}
  function environmentsView(){const page=el('div');const pkg=state.selected;if(!pkg){page.append(empty('Select a package','Environment readiness belongs to an individual Action or Robot package.',nav('Choose package','packages')));return page;}
    const env=state.environment||{status:'Not checked'};page.append(note('Python environment · '+env.status,env.python||env.message||'No interpreter has been resolved.',env.status==='Ready'?'success':env.status==='Unavailable'?'error':'info'));
    page.append(sectionActions('Package environment','An explicit check may download verified tooling and build the declared dependencies. It never replaces your executable overrides.',button('Check environment','check-environment',{primary:true,icon:'check',disabled:pkg.kind==='Agent'}),button('Open terminal','terminal',{icon:'terminal',disabled:pkg.kind==='Agent'}),button('Open configuration','configure',{icon:'settings-gear'})));
    const homes=section('Isolated tooling homes','Actions and Robots use separate storage, caches and environment identities.');const dl=el('dl','wide-details');dl.append(detail('Actions home',state.homes?.actions,true),detail('Robots home',state.homes?.robots,true));homes.append(dl);if(state.homeError)homes.append(note('Home configuration error',state.homeError,'error'));page.append(homes);
    if(pkg.kind==='Action'){const runtime=section('Actions Runtime','Local HTTP service for this Action Package. Opening this view does not start, stop or adopt a listener.');const status=state.runtime;runtime.append(note(status?.kind==='owned-running'?'Owned Runtime is running':status?.kind==='unknown-listener'?'Port belongs to an unverified listener':'Runtime status',status?.message||'Status unavailable.',status?.kind==='owned-running'?'success':'info'));
      runtime.append(actions(button('Start Runtime','runtime-start',{primary:status?.kind!=='owned-running',icon:'play',disabled:status?.kind==='unknown-listener'}),button('Reconnect','runtime-reconnect',{icon:'plug',disabled:status?.kind!=='owned-running'||!status?.canReconnect}),button('Open Runtime','runtime-open',{icon:'link-external',disabled:status?.kind!=='owned-running'})));
      runtime.append(el('p','muted small','Published Runtime 1.0.4 embeds RCC 18.19.3. The extension uses verified RCC 18.19.7; that compatibility distinction is preserved. Canonical managed lifecycle qualification is separate.'));page.append(runtime);}
    const deps=section('Declared dependencies','These are manifest declarations, not a claim about resolved or installed versions.');deps.append(dependencyTable(pkg.dependencies));page.append(deps);return page;
  }
  function runsView(){const page=el('div');page.append(sectionActions('Inspect real execution','Streamed log sessions are retained in this window (up to 15). Work Item results and receipts are selected in Work Items; a log session ID is not a Work Item identity.',button('Open run logs','logs',{primary:true,icon:'output'}),button('Work Item results','work-items',{icon:'briefcase',disabled:!state.selected||state.selected.kind==='Agent'}),button('Diagnostic logs','diagnostics')));
    if(!state.runs.length){page.append(empty('No run logs in this window','Run or debug an Action or Robot task to stream logs here. Reloaded windows do not invent historical log sessions.',nav('Prepare a package','packages')));return page;}
    const table=el('table','data-table');const head=el('tr');for(const title of ['Log session','Identity','Inspect'])head.append(el('th','',title));const thead=el('thead');thead.append(head);table.append(thead);const tbody=el('tbody');for(const run of state.runs){const row=el('tr');const control=el('td');control.append(button('Open logs','open-run',{icon:'output',target:run.id}));row.append(el('td','',run.label),el('td','mono',run.id),control);tbody.append(row);}table.append(tbody);page.append(table);return page;
  }
  function inspectorsView(){const page=el('div');if(!state.selected){page.append(empty('Select a package first','Locators are saved to the selected package, not a global shared store.',nav('Choose package','packages')));return page;}
    page.append(sectionActions('Locators and application tools','Capture, validate and reuse locators without losing the package context. Capture starts only after your explicit action.',button('Manage locators','locators',{primary:true,icon:'layers'}),button('Open package files','reveal',{icon:'files'})));
    const grid=el('div','tool-grid');for(const tool of [{label:'Web',icon:'globe',action:'web-inspector',description:'Pick browser elements, validate selectors and generate actions.',available:true},{label:'Image',icon:'device-desktop',action:'image-inspector',description:'Capture a region, set similarity and validate an image locator.',available:true},{label:'Windows',icon:'window',action:'windows-inspector',description:'Select a native Windows application, inspect its tree and validate locators.',available:state.platform==='win32'},{label:'Java',icon:'coffee',action:'java-inspector',description:'Inspect a Java application through Java Access Bridge.',available:state.platform==='win32'}]){const card=el('section','tool');card.append(icon(tool.icon),el('h2','',tool.label+' Inspector'),el('p','muted',tool.description),el('span','badge',tool.available?'Requires local application / display':'Unavailable on this platform'),button('Open '+tool.label+' Inspector',tool.action,{disabled:!tool.available,reason:tool.available?'':'Requires Windows'}));grid.append(card);}page.append(grid);page.append(sectionActions('Playwright Recorder','A separate browser recorder that uses this package’s interpreter. No browser is opened just by viewing this page.',button('Open recorder','recorder',{icon:'record'})));return page;
  }
  function settingsView(){const page=el('div');page.append(sectionActions('Workspace settings','Friendly labels here; stable compatibility keys remain unchanged for existing workspaces. Edits use VS Code’s native scope, validation and reset controls.',button('Open native Settings','native-settings',{primary:true,icon:'settings-gear'}),button('Import profile','profile-import'),button('Switch profile','profile-switch')));
    for(const setting of state.settings){const row=el('section','setting-row');const info=el('div');info.append(el('h2','',setting.label),el('p','muted',setting.description));const value=el('code','setting-value',Array.isArray(setting.value)?setting.value.join(' '):setting.value===undefined||setting.value===''?'Default / not set':String(setting.value));info.append(value);row.append(info,button('Edit','edit-setting',{target:setting.id}));page.append(row);}
    page.append(sectionActions('Support and diagnostics','Review local logs before opening a private issue draft. Logs are not uploaded automatically.',button('Diagnostic logs','diagnostics',{icon:'output'}),button('Report an issue','report-issue',{icon:'feedback'})));return page;
  }
  window.addEventListener('message', event => {const message=event.data;if(message?.type==='state'){state=message;render();}else if(message?.type==='error'){if(state){state.error=message.message;render();}else app.replaceChildren(note('Unable to load workspace',message.message,'error'));}});
  send({op:'refresh'});
})();
