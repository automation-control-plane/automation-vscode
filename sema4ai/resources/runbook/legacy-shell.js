/* Readable Automation shell for the unchanged Inspector and log-viewer engines. */
(function (global) {
    'use strict';
    const routes = Object.freeze({
        '/locators-manager/': { title: 'Locators', description: 'Review saved locators and generate code for this package.' },
        '/web-inspector/': { title: 'Web Inspector', description: 'Choose a page, then start picking elements in the browser.' },
        '/windows-inspector/': { title: 'Windows Inspector', description: 'Choose a Windows application, inspect its tree, and validate locators.' },
        '/image-inspector/': { title: 'Image Inspector', description: 'Capture an element, tune confidence, then validate and save its locator.' },
        '/java-inspector/': { title: 'Java Inspector', description: 'Inspect a Java application through Java Access Bridge on Windows.' },
    });

    function inspectorRouteEvent(route) {
        return Object.hasOwn(routes, route) ? { type: 'event', id: '', event: { type: 'gotoInspectorApp', status: 'success', data: route } } : undefined;
    }
    function nextInspectorRoute(route, key) {
        const all = Object.keys(routes);
        const index = all.indexOf(route);
        if (index < 0) return undefined;
        if (key === 'Home') return all[0];
        if (key === 'End') return all[all.length - 1];
        if (key === 'ArrowRight') return all[(index + 1) % all.length];
        if (key === 'ArrowLeft') return all[(index + all.length - 1) % all.length];
        return undefined;
    }
    function rgbChannels(color) {
        const match = /^rgba?\(\s*(\d{1,3})[, ]+\s*(\d{1,3})[, ]+\s*(\d{1,3})(?:\s*[,/]\s*[\d.]+)?\s*\)$/.exec(color);
        if (!match || match.slice(1, 4).some(value => Number(value) > 255)) return undefined;
        return match.slice(1, 4).map(Number).join(', ');
    }
    function packageContext(context) {
        const value = context && typeof context === 'object' ? context : {};
        return {
            name: typeof value.packageName === 'string' && value.packageName ? value.packageName : 'No package selected',
            kind: value.packageType === 'action' ? 'Action Package' : value.packageType === 'robot' ? 'Robot Task' : value.packageType === 'agent' ? 'Agent Package' : 'Package',
            directory: typeof value.directory === 'string' ? value.directory : '',
        };
    }
    function webInspectorFailure(previous, message) {
        if (message?.type !== 'event' || message.event?.type !== 'browserState') return previous;
        const event = message.event;
        if (event.status === 'failure' && typeof event.message === 'string' && event.message) return event.message.slice(0, 16384);
        if (event.status === 'success' && event.data === 'opened') return undefined;
        return previous;
    }
    function outputMessage(state, message) {
        if (!message || message.type !== 'request') return state;
        if (message.command === 'setContents' && typeof message.runId === 'string') {
            const label = message.allRunIdsToLabel && message.allRunIdsToLabel[message.runId];
            return { runId: message.runId, label: typeof label === 'string' ? label : message.runId };
        }
        if (message.command === 'updateLabel' && message.runId === state.runId && typeof message.label === 'string') {
            return { runId: state.runId, label: message.label };
        }
        return state;
    }
    if (typeof module === 'object' && module.exports) module.exports = { inspectorRouteEvent, nextInspectorRoute, rgbChannels, packageContext, outputMessage, webInspectorFailure };
    if (!global || !global.document) return;

    function initialize() {
        const document = global.document;
        const contextElement = document.getElementById('automation-surface-context');
        if (!contextElement) return;
        let context;
        try { context = JSON.parse(contextElement.textContent || '{}'); } catch { return; }
        const setText = (id, text) => { const element = document.getElementById(id); if (element) element.textContent = text; };
        const surface = document.body.dataset.automationSurface;
        const contrastTokens = {
            text: ['content-primary', 'content-primary-hovered', 'content-subtle', 'content-subtle-hovered', 'content-subtle-light', 'content-subtle-light-hovered', 'content-disabled'],
            bg: ['background-primary', 'background-subtle-light', 'background-input', 'content-inversed'],
            surface: ['background-subtle', 'background-subtle-hovered', 'background-subtle-light-hovered', 'background-panel', 'background-hero', 'background-disabled', 'background-tab-interactive'],
            border: ['border-primary', 'border-primary-hovered', 'border-subtle', 'border-subtle-hovered', 'border-disabled'],
            accent: ['content-accent', 'content-accent-hovered', 'background-control-primary', 'background-control-primary-hovered', 'background-accent', 'background-accent-hovered', 'border-accent', 'border-accent-hovered', 'outline'],
            'accent-text': ['content-control-primary', 'content-control-primary-hovered'],
            success: ['content-success', 'content-success-hovered'],
            danger: ['content-error', 'content-error-hovered'],
        };
        const syncContrast = () => {
            const contrast = document.body.classList.contains('vscode-high-contrast') || document.body.classList.contains('vscode-high-contrast-light');
            const probe = document.createElement('span');
            probe.hidden = true;
            if (contrast) document.body.appendChild(probe);
            for (const [token, targets] of Object.entries(contrastTokens)) {
                let channels;
                if (contrast) {
                    probe.style.color = 'var(--automation-' + token + ')';
                    channels = rgbChannels(global.getComputedStyle(probe).color);
                }
                for (const target of targets) {
                    if (channels) document.body.style.setProperty('--color-' + target, channels);
                    else document.body.style.removeProperty('--color-' + target);
                }
            }
            probe.remove();
        };
        new MutationObserver(syncContrast).observe(document.body, { attributes: true, attributeFilter: ['class'] });
        syncContrast();

        if (surface === 'inspector') {
            const pkg = packageContext(context);
            setText('automation-inspector-package', pkg.name);
            setText('automation-inspector-kind', pkg.kind);
            setText('automation-inspector-path', pkg.directory);
            let lastRoute;
            let browserFailure;
            const renderBrowserFailure = () => {
                const banner = document.getElementById('automation-inspector-error');
                if (banner) banner.hidden = !browserFailure || lastRoute !== '/web-inspector/';
                setText('automation-inspector-error-message', browserFailure || '');
            };
            const syncRoute = (requested) => {
                const hashRoute = global.location.hash.slice(1).split('?')[0];
                const route = Object.hasOwn(routes, requested) ? requested : Object.hasOwn(routes, hashRoute) ? hashRoute : context.startRoute;
                if (!Object.hasOwn(routes, route) || route === lastRoute) return;
                lastRoute = route;
                renderBrowserFailure();
                document.body.dataset.inspectorRoute = route;
                setText('automation-inspector-title', routes[route].title);
                setText('automation-inspector-description', routes[route].description);
                for (const button of document.querySelectorAll('[data-inspector-route]')) {
                    if (button.tagName !== 'BUTTON') continue;
                    const selected = button.dataset.inspectorRoute === route;
                    button.id = 'automation-tab-' + button.dataset.inspectorRoute.replace(/\//g, '');
                    button.setAttribute('aria-selected', String(selected));
                    button.setAttribute('aria-controls', 'root');
                    button.tabIndex = selected ? 0 : -1;
                    const root = document.getElementById('root');
                    if (selected && root) { root.setAttribute('role', 'tabpanel'); root.setAttribute('aria-labelledby', button.id); }
                }
            };
            for (const button of document.querySelectorAll('button[data-inspector-route]')) {
                button.addEventListener('click', () => {
                    const event = inspectorRouteEvent(button.dataset.inspectorRoute);
                    if (!event) return;
                    global.dispatchEvent(new MessageEvent('message', { data: event }));
                    syncRoute(event.event.data);
                });
                button.addEventListener('keydown', event => {
                    const route = nextInspectorRoute(button.dataset.inspectorRoute, event.key);
                    if (!route) return;
                    event.preventDefault();
                    const target = document.querySelector('button[data-inspector-route="' + route + '"]');
                    if (target) { target.focus(); target.click(); }
                });
            }
            global.addEventListener('message', ({ data }) => {
                if (data?.type === 'event' && data.event?.type === 'gotoInspectorApp' && data.event.status === 'success') syncRoute(data.event.data);
                browserFailure = webInspectorFailure(browserFailure, data);
                renderBrowserFailure();
            });
            global.addEventListener('hashchange', () => syncRoute());
            global.addEventListener('popstate', () => syncRoute());
            // The frozen engine's HashRouter uses pushState. Observe its rendered
            // root to synchronize labels, without mutating its DOM or listeners.
            const root = document.getElementById('root');
            if (root) new MutationObserver(() => syncRoute()).observe(root, { subtree: true, childList: true });
            syncRoute(context.startRoute || '/locators-manager/');
        } else if (surface === 'output') {
            let state = { runId: typeof context.runId === 'string' ? context.runId : undefined, label: typeof context.label === 'string' ? context.label : '' };
            const update = () => {
                setText('automation-output-selection', state.label || 'No run selected');
                const empty = document.getElementById('automation-output-empty');
                if (empty) empty.hidden = Boolean(state.runId);
                document.body.dataset.outputHasRun = String(Boolean(state.runId));
            };
            global.addEventListener('message', ({ data }) => { state = outputMessage(state, data); update(); });
            update();
        }
    }
    if (global.document.readyState === 'complete') initialize();
    else global.addEventListener('load', initialize, { once: true });
})(typeof window === 'undefined' ? undefined : window);
