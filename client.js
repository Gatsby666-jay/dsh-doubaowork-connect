window.__ModuleLoader__.load({
	id: 'dsh-doubaowork-connect',
	factory: (require) => {
		const React = require('react')
		const ReactDOM = require('react-dom')

		const h = React.createElement

		/* ------------------------------------------------------------------ *
		 * Strings
		 *
		 * Kept inline rather than fetched: the settings section renders before
		 * any request could complete, and a missing dictionary must never blank
		 * the page.
		 * ------------------------------------------------------------------ */

		const STRINGS = {
			zh: {
				'title': '豆包工作',
				'tab.account': '账号',
				'tab.models': '模型',
				'account.intro': '从本机豆包客户端读取登录态，或者粘贴一次 Cookie。插件只读，不会改动客户端。',
				'account.importDesktop': '从本机豆包读取',
				'account.importCookie': '粘贴 Cookie 登录',
				'account.cookieHint': '在已登录的 www.doubao.com 页面里复制 Cookie 请求头即可，至少需要 sessionid。',
				'account.cookiePlaceholder': 'sessionid=...; passport_csrf_token=...',
				'account.save': '保存',
				'account.accounts': '已登录账号',
				'account.active': '当前使用',
				'account.select': '切换',
				'account.remove': '移除',
				'account.rename': '重命名',
				'account.recheck': '清除冷却并重试',
				'account.cooldown': '冷却中',
				'account.pool': '账号池',
				'account.poolOn': '开启账号池自动换号',
				'account.poolHint': '开启后，勾选的账号轮流服务；某个账号登录失效、被要求验证或被限流时，本次请求自动换下一个账号。',
				'account.poolMembers': '参与账号池的账号',
				'account.empty': '还没有登录任何豆包账号。',
				'account.refreshed': '已从本机读取登录态',
				'account.added': '新增',
				'account.updated': '更新',
				'account.skippedCount': '跳过',
				'account.sourceDesktop': '本机客户端',
				'account.sourceCookie': 'Cookie',
				'models.refreshedCount': '已刷新 {n} 个模型',
				'account.skipped': '跳过的配置',
				'account.confirmRemove': '移除后这个账号的登录态会从插件里删掉，粘贴来的 Cookie 账号只能重新登录。确定移除？',
				'account.deviceNote': '如果读不到，请在插件配置里把 userDataDir 指向豆包客户端的 User Data 目录。',
				'models.intro': '目录来自上游，倍率由上游给出，插件不写死也不猜。',
				'models.snapshotWarning': '当前显示的是内置快照，倍率要刷新后才有。',
				'models.refresh': '刷新模型目录',
				'models.refreshing': '正在刷新…',
				'models.source': '目录来源',
				'models.sourceOfficial': '上游目录',
				'models.sourceBuiltin': '内置快照',
				'models.updatedAt': '上次刷新',
				'models.rate': '积分倍率',
				'models.rateUnknown': '上游未给出',
				'models.free': '免费',
				'models.context': '上下文',
				'models.levels': '推理档位',
				'models.enabled': '显示',
				'models.image': '图片输入',
				'models.needUpgrade': '需订阅',
				'models.noModels': '目录还没有刷新成功，先点一次刷新。',
				'credits.title': '积分',
				'credits.remaining': '剩余',
				'credits.quotaWindow': '订阅额度',
				'credits.checkin': '每日签到',
				'credits.checkedIn': '今日已签',
				'credits.notCheckedIn': '今日未签',
				'credits.continuous': '连续',
				'credits.days': '天',
				'credits.checkinReadOnly': '签到只能在豆包客户端里完成，插件只读，不会代签。',
				'credits.refresh': '刷新积分',
				'credits.refreshing': '正在刷新…',
				'credits.noData': '还没有积分读数，点一次刷新。',
				'credits.needsAccount': '先在账号页导入一个账号，才有积分可读。',
				'credits.updatedAt': '更新于',
				'composer.remaining': '积分',
				'composer.checkedIn': '已签到',
				'composer.notCheckedIn': '未签到',
				'composer.open': '查看积分详情',
				'composer.account': '账号',
				'composer.pool': '账号池',
				'composer.accounts': '个账号',
				'common.loading': '正在读取…',
				'common.failed': '操作失败',
				'common.saving': '已保存',
			},
			en: {
				'title': '豆包工作',
				'tab.account': 'Accounts',
				'tab.models': 'Models',
				'account.intro': 'Read the sign-in from the local Doubao client, or paste a Cookie once. The plugin is read-only and never modifies the client.',
				'account.importDesktop': 'Read from local Doubao',
				'account.importCookie': 'Sign in with a cookie',
				'account.cookieHint': 'Copy the Cookie request header from a signed-in www.doubao.com tab. sessionid is required.',
				'account.cookiePlaceholder': 'sessionid=...; passport_csrf_token=...',
				'account.save': 'Save',
				'account.accounts': 'Signed-in accounts',
				'account.active': 'In use',
				'account.select': 'Switch',
				'account.remove': 'Remove',
				'account.rename': 'Rename',
				'account.recheck': 'Clear cooldowns and retry',
				'account.cooldown': 'Cooling down',
				'account.pool': 'Account pool',
				'account.poolOn': 'Automatic failover across the pool',
				'account.poolHint': 'When on, the checked accounts serve in turn; if one has an expired session, is asked to verify, or is rate limited, the request moves to the next account.',
				'account.poolMembers': 'Accounts in the pool',
				'account.empty': 'No Doubao account is signed in yet.',
				'account.refreshed': 'Read the sign-in from this machine',
				'account.added': 'added',
				'account.updated': 'updated',
				'account.skippedCount': 'skipped',
				'account.sourceDesktop': 'Local client',
				'account.sourceCookie': 'Cookie',
				'models.refreshedCount': 'Refreshed {n} models',
				'account.skipped': 'Skipped profiles',
				'account.confirmRemove': 'Removing this account deletes its sign-in from the plugin. An account added by pasting a cookie can only come back by signing in again. Remove it?',
				'account.deviceNote': 'If nothing is found, point the plugin config at the Doubao client\'s User Data directory (userDataDir).',
				'models.intro': 'The catalog comes from upstream, and so does every multiplier. The plugin neither hardcodes nor guesses them.',
				'models.snapshotWarning': 'Showing the built-in snapshot; multipliers appear after a refresh.',
				'models.refresh': 'Refresh catalog',
				'models.refreshing': 'Refreshing…',
				'models.source': 'Catalog source',
				'models.sourceOfficial': 'Upstream catalog',
				'models.sourceBuiltin': 'Built-in snapshot',
				'models.updatedAt': 'Last refresh',
				'models.rate': 'Credit multiplier',
				'models.rateUnknown': 'Not reported upstream',
				'models.free': 'Free',
				'models.context': 'Context',
				'models.levels': 'Reasoning efforts',
				'models.enabled': 'Show',
				'models.image': 'Image input',
				'models.needUpgrade': 'Subscription',
				'models.noModels': 'The catalog has not loaded yet. Refresh it.',
				'credits.title': 'Credits',
				'credits.remaining': 'Remaining',
				'credits.quotaWindow': 'Allowance',
				'credits.checkin': 'Daily check-in',
				'credits.checkedIn': 'Checked in',
				'credits.notCheckedIn': 'Not checked in',
				'credits.continuous': 'Streak',
				'credits.days': 'd',
				'credits.checkinReadOnly': 'Check-in is only possible in the Doubao client. The plugin is read-only and never claims it.',
				'credits.refresh': 'Refresh credits',
				'credits.refreshing': 'Refreshing…',
				'credits.noData': 'No credit reading yet. Refresh once.',
				'credits.needsAccount': 'Import an account on the Accounts tab first; there is no credit to read yet.',
				'credits.updatedAt': 'Updated',
				'composer.remaining': 'credits',
				'composer.checkedIn': 'checked in',
				'composer.notCheckedIn': 'not checked in',
				'composer.open': 'Open credit details',
				'composer.account': 'Account',
				'composer.pool': 'Account pool',
				'composer.accounts': 'accounts',
				'common.loading': 'Loading…',
				'common.failed': 'Action failed',
				'common.saving': 'Saved',
			},
		}

		function pickLocale() {
			try {
				const tag = globalThis.document?.documentElement?.lang
					|| globalThis.navigator?.language
					|| 'zh'
				return String(tag).toLowerCase().startsWith('zh') ? 'zh' : 'en'
			} catch {
				return 'zh'
			}
		}

		const LANG = pickLocale()
		const t = (key, vars) => {
			const template = STRINGS[LANG]?.[key] ?? STRINGS.zh[key] ?? key
			if (!vars) return template
			return String(template).replace(/\{(\w+)\}/g, (match, name) => (
				vars[name] === undefined ? match : String(vars[name])
			))
		}

		/* ------------------------------------------------------------------ *
		 * Host API
		 * ------------------------------------------------------------------ */

		const API = '/plugins/dsh-doubaowork-connect'

		/** Resolve against the page base so a sub-path mount keeps its prefix. */
		function resolveUrl(logical) {
			const base = globalThis.document?.baseURI
			if (!base) return logical
			try {
				const url = new URL(logical, base)
				return url.pathname + url.search
			} catch {
				return logical
			}
		}

		async function request(path, init) {
			const response = await fetch(resolveUrl(API + path), {
				credentials: 'same-origin',
				...init,
			})
			const text = await response.text()
			let body
			try { body = text ? JSON.parse(text) : {} } catch {
				throw new Error(`服务返回了非 JSON 内容：${text.slice(0, 120)}`)
			}
			if (!response.ok) throw new Error(body?.error || `${t('common.failed')}（HTTP ${response.status}）`)
			return body
		}

		const getJson = (path) => request(path, { method: 'GET' })
		const postJson = (path, payload) => request(path, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(payload ?? {}),
		})

		/* ------------------------------------------------------------------ *
		 * Styles
		 *
		 * Rendered as a React element inside each registration so unmounting the
		 * plugin removes them with it.
		 * ------------------------------------------------------------------ */

		const CSS = `
.dcbw-root{display:flex;flex-direction:column;gap:14px;min-width:0;
  color:var(--dsw-alias-label-primary,#e8e9ed);font-size:13px;line-height:1.5}
.dcbw-tabs{display:flex;gap:2px;border-bottom:1px solid var(--dsw-alias-border-l1,#2a2c33)}
.dcbw-tab{appearance:none;border:0;background:transparent;cursor:pointer;
  padding:7px 12px;border-radius:7px 7px 0 0;font-size:13px;line-height:18px;
  color:var(--dsw-alias-label-secondary,#a9adb8)}
.dcbw-tab:hover{background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.1))}
.dcbw-tab[data-on="true"]{color:var(--dsw-alias-label-primary,#e8e9ed);
  box-shadow:inset 0 -2px 0 var(--dsw-alias-brand-primary,#5686fe)}
.dcbw-panel{display:flex;flex-direction:column;gap:12px;min-width:0}
.dcbw-card{border:1px solid var(--dsw-alias-border-l1,#2a2c33);
  border-radius:var(--dsw-radius-xl,10px);
  background:var(--dsw-alias-bg-layer-1,#1b1d23);padding:12px;display:flex;
  flex-direction:column;gap:10px;min-width:0}
.dcbw-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dcbw-title{font-weight:600;font-size:13px}
.dcbw-hint{color:var(--dsw-alias-label-tertiary,#8b8f9a);font-size:12px;line-height:1.5;
  overflow-wrap:anywhere}
.dcbw-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0}
.dcbw-grow{flex:1 1 auto;min-width:120px}
.dcbw-btn{appearance:none;cursor:pointer;font-size:12px;line-height:18px;
  padding:5px 10px;border-radius:7px;border:1px solid var(--dsw-alias-border-l2,#3a3d45);
  background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.1));
  color:var(--dsw-alias-label-primary,#e8e9ed);white-space:nowrap}
.dcbw-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.18))}
.dcbw-btn:disabled{opacity:.5;cursor:default}
.dcbw-btn[data-primary="true"]{background:var(--dsw-alias-brand-primary,#5686fe);
  border-color:transparent;color:#fff}
.dcbw-btn[data-danger="true"]{color:var(--dsw-alias-state-error-primary,#f1667a)}
.dcbw-input{flex:1 1 auto;min-width:0;font:inherit;font-size:12px;
  padding:6px 9px;border-radius:7px;border:1px solid var(--dsw-alias-border-l2,#3a3d45);
  background:var(--dsw-alias-bg-base,#12141a);color:var(--dsw-alias-label-primary,#e8e9ed)}
.dcbw-input:focus{outline:2px solid var(--dsw-alias-brand-primary,#5686fe);outline-offset:1px}
.dcbw-ta{min-height:64px;resize:vertical;font-family:inherit;width:100%}
.dcbw-rate{display:inline-flex;align-items:center;padding:1px 6px;border-radius:999px;
  font-size:11px;line-height:16px;font-variant-numeric:tabular-nums;flex:0 0 auto;
  border:1px solid var(--dsw-alias-border-l2,#3a3d45);
  color:var(--dsw-alias-label-secondary,#a9adb8)}
.dcbw-rate[data-tone="success"]{color:var(--dsw-alias-state-success-primary,#3fb950);
  border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary,#3fb950) 45%,transparent)}
.dcbw-rate[data-tone="info"]{color:var(--dsw-alias-brand-primary,#5686fe);
  border-color:color-mix(in srgb,var(--dsw-alias-brand-primary,#5686fe) 45%,transparent)}
.dcbw-rate[data-tone="warning"]{color:var(--dsw-alias-state-warn-primary,#d29922);
  border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#d29922) 45%,transparent)}
.dcbw-sw{appearance:none;cursor:pointer;width:32px;height:18px;border-radius:999px;
  border:0;position:relative;flex:0 0 auto;background:var(--dsw-alias-state-idle-primary,#4a4d55);
  transition:background .12s ease;padding:0}
/* The knob is control artwork, not a surface: it has to read against the brand
   track in BOTH themes, and no theme token is light-on-blue in both. Everything
   else in this stylesheet is a var(--dsw-*) reference; this one literal is
   deliberate and is the only one. */
.dcbw-sw::after{content:"";position:absolute;top:2px;left:2px;width:14px;height:14px;
  border-radius:999px;background:#fff;transition:transform .12s ease}
.dcbw-sw[data-on="true"]{background:var(--dsw-alias-brand-primary,#5686fe)}
.dcbw-sw[data-on="true"]::after{transform:translateX(14px)}
.dcbw-sw:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#5686fe);outline-offset:2px}
.dcbw-sw:disabled{opacity:.45;cursor:default}
.dcbw-models{display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l1,#2a2c33);
  border-radius:10px;overflow:hidden}
.dcbw-model{display:flex;align-items:center;gap:10px;padding:9px 12px;min-width:0;
  border-bottom:1px solid var(--dsw-alias-border-l1,#2a2c33);flex-wrap:wrap}
.dcbw-model:last-child{border-bottom:0}
.dcbw-model[data-off="true"]{opacity:.55}
.dcbw-model-name{font-size:12.5px;min-width:110px;flex:0 1 auto;overflow-wrap:anywhere}
.dcbw-model-meta{color:var(--dsw-alias-label-tertiary,#8b8f9a);font-size:11.5px;
  flex:1 1 auto;min-width:90px}
.dcbw-err{color:var(--dsw-alias-state-error-primary,#f1667a);font-size:12px;overflow-wrap:anywhere}
.dcbw-ok{color:var(--dsw-alias-state-success-primary,#3fb950);font-size:12px}
.dcbw-list{display:flex;flex-direction:column;gap:8px;min-width:0}
.dcbw-acct{display:flex;align-items:center;gap:8px;flex-wrap:wrap;
  padding:9px 12px;border-radius:9px;border:1px solid var(--dsw-alias-border-l1,#2a2c33)}
.dcbw-acct[data-active="true"]{border-color:color-mix(in srgb,var(--dsw-alias-brand-primary,#5686fe) 55%,transparent)}
.dcbw-tag{font-size:11px;line-height:16px;padding:0 6px;border-radius:999px;
  background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.14));
  color:var(--dsw-alias-label-secondary,#a9adb8);flex:0 0 auto}
.dcbw-kv{display:flex;gap:18px;flex-wrap:wrap}
.dcbw-kv>div{display:flex;flex-direction:column;gap:2px;min-width:60px}
.dcbw-kv dt{font-size:11px;color:var(--dsw-alias-label-tertiary,#8b8f9a);margin:0}
.dcbw-kv dd{margin:0;font-size:15px;font-variant-numeric:tabular-nums}
.dcbw-pill{display:inline-flex;align-items:center;min-width:0}
.dcbw-pill-btn{appearance:none;display:inline-flex;align-items:center;align-self:stretch;
  padding:2px 6px;border:0;border-radius:6px;background:transparent;
  font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,#8b8f9a);
  white-space:nowrap;cursor:pointer;font-variant-numeric:tabular-nums}
.dcbw-pill-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.14))}
.dcbw-pill-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#5686fe);outline-offset:1px}
.dcbw-pop{position:fixed;z-index:60;min-width:220px;max-width:320px;padding:10px 12px;
  border-radius:var(--dsw-radius-xl,10px);border:1px solid var(--dsw-alias-border-l1,#2a2c33);
  background:var(--dsw-alias-bg-overlay,#22242b);
  /* Popover elevation: the overlay surface already carries a border, so the
     shadow only has to separate it from the page, not define it. */
  box-shadow:0 12px 32px color-mix(in srgb,var(--dsw-alias-bg-base,#000) 70%,transparent);
  font-size:12px;line-height:1.55;
  color:var(--dsw-alias-label-primary,#e8e9ed);display:flex;flex-direction:column;gap:6px}
.dcbw-pop-row{display:flex;justify-content:space-between;gap:12px}
.dcbw-pop-row>span:first-child{color:var(--dsw-alias-label-tertiary,#8b8f9a)}
`

		function PluginStyle() {
			return h('style', { 'data-plugin': 'dsh-doubaowork-connect' }, CSS)
		}

		/* ------------------------------------------------------------------ *
		 * Primitives
		 * ------------------------------------------------------------------ */

		function Switch(props) {
			return h('button', {
				type: 'button',
				className: 'dcbw-sw',
				role: 'switch',
				'aria-checked': props.on ? 'true' : 'false',
				'aria-label': props.label,
				'data-on': props.on ? 'true' : 'false',
				disabled: props.disabled ? true : undefined,
				onClick: () => { if (!props.disabled) props.onChange(!props.on) },
			})
		}

		function formatNumber(value) {
			if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
			return value.toLocaleString()
		}

		function formatTime(ms) {
			if (!ms) return '—'
			try { return new Date(ms).toLocaleString() } catch { return '—' }
		}

		function rateTone(model) {
			if (model.free) return 'success'
			if (typeof model.rate !== 'number') return 'neutral'
			if (model.rate <= 0.1) return 'success'
			if (model.rate <= 0.6) return 'info'
			if (model.rate <= 1) return 'neutral'
			return 'warning'
		}

		/* ------------------------------------------------------------------ *
		 * Accounts tab
		 * ------------------------------------------------------------------ */

		function AccountsTab(props) {
			const { data, busy, run } = props
			const [cookie, setCookie] = React.useState('')
			const [showCookie, setShowCookie] = React.useState(false)
			const [drafts, setDrafts] = React.useState({})
			const [skipped, setSkipped] = React.useState([])

			const accounts = data?.accounts ?? []
			const pool = data?.pool ?? { enabled: false, members: [] }

			const importDesktop = () => run(async () => {
				const result = await postJson('/import', { source: 'desktop' })
				const reasons = Array.isArray(result.skipped) ? result.skipped : []
				setSkipped(reasons)
				const parts = []
				if (result.added?.length) parts.push(`${t('account.added')} ${result.added.length}`)
				if (result.updated) parts.push(`${t('account.updated')} ${result.updated}`)
				if (reasons.length) parts.push(`${t('account.skippedCount')} ${reasons.length}`)
				return parts.length ? `${t('account.refreshed')}：${parts.join('，')}` : t('account.refreshed')
			})

			const importCookie = () => run(async () => {
				await postJson('/import', { source: 'cookie', cookie })
				setCookie('')
				setShowCookie(false)
				setSkipped([])
				return t('common.saving')
			})

			const select = (id) => run(() => postJson('/accounts', { action: 'select', id }))
			const remove = (id) => {
				if (!globalThis.confirm?.(t('account.confirmRemove'))) return undefined
				setSkipped([])
				return run(() => postJson('/accounts', { action: 'remove', id }))
			}
			const recheck = () => run(() => postJson('/accounts', { action: 'recheck' }))
			const saveLabel = (id) => run(async () => {
				if (typeof drafts[id] !== 'string') return undefined
				await postJson('/accounts', { action: 'label', id, label: drafts[id] })
				setDrafts({ ...drafts, [id]: undefined })
				return t('common.saving')
			})

			const togglePool = (enabled) => run(() => postJson('/pool', { enabled }))
			const toggleMember = (id, on) => {
				const members = new Set(pool.members)
				if (on) members.add(id)
				else members.delete(id)
				return run(() => postJson('/pool', { members: [...members] }))
			}

			return h('div', { className: 'dcbw-panel' }, [
				h('div', { className: 'dcbw-hint', key: 'intro' }, t('account.intro')),
				h('div', { className: 'dcbw-row', key: 'actions' }, [
					h('button', {
						key: 'desktop',
						type: 'button',
						className: 'dcbw-btn',
						'data-primary': 'true',
						disabled: busy,
						onClick: importDesktop,
					}, t('account.importDesktop')),
					h('button', {
						key: 'cookie',
						type: 'button',
						className: 'dcbw-btn',
						disabled: busy,
						onClick: () => setShowCookie(!showCookie),
					}, t('account.importCookie')),
					accounts.length
						? h('button', {
							key: 'recheck',
							type: 'button',
							className: 'dcbw-btn',
							disabled: busy,
							onClick: recheck,
						}, t('account.recheck'))
						: null,
				]),
				showCookie
					? h('div', { className: 'dcbw-card', key: 'cookie' }, [
						h('div', { className: 'dcbw-hint', key: 'hint' }, t('account.cookieHint')),
						h('textarea', {
							key: 'input',
							className: 'dcbw-input dcbw-ta',
							placeholder: t('account.cookiePlaceholder'),
							value: cookie,
							onChange: (event) => setCookie(event.target.value),
						}),
						h('div', { className: 'dcbw-row', key: 'go' }, [
							h('button', {
								key: 'save',
								type: 'button',
								className: 'dcbw-btn',
								'data-primary': 'true',
								disabled: busy || !cookie.trim(),
								onClick: importCookie,
							}, t('account.save')),
						]),
					])
					: null,
				// A skipped profile explains itself here: "跳过 2" with an empty list
				// gives the user nothing to act on, and the common cause (app-bound
				// cookies, a locked database) has a known remedy.
				skipped.length
					? h('div', { className: 'dcbw-card', key: 'skipped' }, [
						h('div', { className: 'dcbw-head', key: 'head' }, [
							h('span', { className: 'dcbw-title', key: 't' }, t('account.skipped')),
							h('span', { className: 'dcbw-tag', key: 'c' }, String(skipped.length)),
						]),
						...skipped.slice(0, 5).map((row, index) => h('div', {
							key: `s${index}`,
							className: 'dcbw-hint',
						}, `${row.profile || '—'}：${row.reason || '未知原因'}`)),
						h('div', { className: 'dcbw-hint', key: 'note' }, t('account.deviceNote')),
					])
					: null,
				h('div', { className: 'dcbw-card', key: 'list' }, [
					h('div', { className: 'dcbw-head', key: 'head' }, [
						h('span', { className: 'dcbw-title', key: 'title' }, t('account.accounts')),
						h('span', { className: 'dcbw-tag', key: 'count' }, String(accounts.length)),
					]),
					accounts.length
						? h('div', { className: 'dcbw-list', key: 'rows' }, accounts.map((account) => h('div', {
							key: account.id,
							className: 'dcbw-acct',
							'data-active': account.isActive ? 'true' : 'false',
						}, [
							h('div', { className: 'dcbw-grow', key: 'name' }, [
								h('div', { key: 'l', style: { fontSize: '12.5px' } },
									account.label || account.id.slice(0, 8)),
								h('div', { className: 'dcbw-hint', key: 'm' }, [
									account.source === 'desktop'
										? t('account.sourceDesktop')
										: t('account.sourceCookie'),
									account.profile ? ` · ${account.profile}` : '',
									account.cooldown
										? ` · ${t('account.cooldown')}：${account.cooldown.reason}`
										: '',
								].join('')),
							]),
							account.isActive
								? h('span', { className: 'dcbw-tag', key: 'a' }, t('account.active'))
								: null,
							h('input', {
								key: 'rename',
								className: 'dcbw-input',
								style: { flex: '0 1 110px', minWidth: '72px' },
								placeholder: t('account.rename'),
								value: drafts[account.id] ?? '',
								onChange: (event) => setDrafts({ ...drafts, [account.id]: event.target.value }),
								onKeyDown: (event) => { if (event.key === 'Enter') saveLabel(account.id) },
							}),
							h('button', {
								key: 'save',
								type: 'button',
								className: 'dcbw-btn',
								disabled: busy,
								onClick: () => saveLabel(account.id),
							}, t('account.save')),
							account.isActive
								? null
								: h('button', {
									key: 'sel',
									type: 'button',
									className: 'dcbw-btn',
									disabled: busy,
									onClick: () => select(account.id),
								}, t('account.select')),
							h('button', {
								key: 'rm',
								type: 'button',
								className: 'dcbw-btn',
								'data-danger': 'true',
								disabled: busy,
								onClick: () => remove(account.id),
							}, t('account.remove')),
						])))
						: h('div', { className: 'dcbw-hint', key: 'empty' }, t('account.empty')),
				]),
				h('div', { className: 'dcbw-card', key: 'pool' }, [
					h('div', { className: 'dcbw-head', key: 'head' }, [
						h('span', { className: 'dcbw-title', key: 't' }, t('account.pool')),
						h('span', { className: 'dcbw-grow', key: 'sp' }),
						h(Switch, {
							key: 'sw',
							on: pool.enabled,
							label: t('account.poolOn'),
							disabled: busy || !accounts.length,
							onChange: togglePool,
						}),
					]),
					h('div', { className: 'dcbw-hint', key: 'hint' }, t('account.poolHint')),
					accounts.length
						? h('div', { className: 'dcbw-list', key: 'members' }, [
							h('div', { className: 'dcbw-hint', key: 'label' }, t('account.poolMembers')),
							...accounts.map((account) => h('div', {
								key: account.id,
								className: 'dcbw-row',
							}, [
								h(Switch, {
									key: 'sw',
									on: pool.members.includes(account.id),
									label: account.label || account.id.slice(0, 8),
									disabled: busy,
									onChange: (on) => toggleMember(account.id, on),
								}),
								h('span', { key: 'n', style: { fontSize: '12.5px' } },
									account.label || account.id.slice(0, 8)),
							])),
						])
						: null,
				]),
				h(CreditsCard, { key: 'credits', data, busy, run }),
			])
		}

		function CreditsCard(props) {
			const { data, busy, run } = props
			const credits = data?.credits ?? {}
			const quota = credits.quota
			const checkin = credits.checkin
			const windows = Array.isArray(quota?.windows) ? quota.windows : []
			const hasAccount = (data?.accounts ?? []).length > 0

			/**
			 * Refresh through the /credits response, not through a reload.
			 *
			 * The host answers a failed read with `quotaError`/`checkinError`
			 * beside the cached reading. Reloading the snapshot would show the old
			 * numbers and look like a refresh that simply changed nothing.
			 */
			const refresh = () => run(async () => {
				const result = await postJson('/credits', { force: true })
				const failures = [result?.credits?.quotaError, result?.credits?.checkinError].filter(Boolean)
				if (failures.length) throw new Error(failures.join('；'))
				return t('common.saving')
			})

			const windowViews = windows
				.filter((row) => row.total !== null && row.total !== undefined)
				.slice(0, 4)

			// A null remainder means upstream did not report it, which is not the
			// same as zero: showing "0 / total" would claim the user is out.
			const amountText = (remaining, total) => {
				const left = typeof remaining === 'number' ? formatNumber(remaining) : '—'
				const whole = typeof total === 'number' ? formatNumber(total) : '—'
				return `${left} / ${whole}`
			}

			return h('div', { className: 'dcbw-card' }, [
				h('div', { className: 'dcbw-head', key: 'head' }, [
					h('span', { className: 'dcbw-title', key: 't' }, t('credits.title')),
					h('span', { className: 'dcbw-grow', key: 'sp' }),
					h('button', {
						key: 'r',
						type: 'button',
						className: 'dcbw-btn',
						disabled: busy || !hasAccount,
						title: hasAccount ? undefined : t('credits.needsAccount'),
						onClick: refresh,
					}, busy ? t('credits.refreshing') : t('credits.refresh')),
				]),
				!hasAccount
					? h('div', { className: 'dcbw-hint', key: 'needs' }, t('credits.needsAccount'))
					: quota
						? h('dl', { className: 'dcbw-kv', key: 'kv' }, [
						typeof quota.remaining === 'number'
							? h('div', { key: 'rem' }, [
								h('dt', { key: 'k' }, t('credits.remaining')),
								h('dd', { key: 'v' }, formatNumber(quota.remaining)),
							])
							: null,
						...windowViews.map((row, index) => h('div', { key: `w${index}` }, [
							h('dt', { key: 'k' }, row.name || t('credits.quotaWindow')),
							h('dd', { key: 'v' }, amountText(row.remaining, row.total)),
						])),
					])
					: h('div', { className: 'dcbw-hint', key: 'nodata' }, t('credits.noData')),
				quota?.updatedAt
					? h('div', { className: 'dcbw-hint', key: 'up' },
						`${t('credits.updatedAt')} ${formatTime(quota.updatedAt)}`)
					: null,
				h('div', { className: 'dcbw-row', key: 'checkin' }, [
					h('span', { className: 'dcbw-title', key: 'k', style: { fontSize: '12.5px' } },
						t('credits.checkin')),
					checkin
						? h('span', {
							key: 'v',
							className: checkin.checkedInToday ? 'dcbw-ok' : 'dcbw-hint',
						}, [
							checkin.checkedInToday ? t('credits.checkedIn') : t('credits.notCheckedIn'),
							typeof checkin.continuousDays === 'number'
								? ` · ${t('credits.continuous')} ${checkin.continuousDays} ${t('credits.days')}`
								: '',
						].join(''))
						: h('span', { className: 'dcbw-hint', key: 'v' }, '—'),
				]),
				h('div', { className: 'dcbw-hint', key: 'ro' }, t('credits.checkinReadOnly')),
			])
		}

		/* ------------------------------------------------------------------ *
		 * Models tab
		 * ------------------------------------------------------------------ */

		function ModelsTab(props) {
			const { data, busy, run } = props
			const models = data?.models ?? []
			const catalog = data?.catalog ?? {}

			const refresh = () => run(async () => {
				const result = await postJson('/models', { action: 'refresh' })
				if (result?.refresh && result.refresh.ok === false) {
					throw new Error(result.refresh.error || t('common.failed'))
				}
				return t('models.refreshedCount', { n: result?.catalog?.count ?? 0 })
			})

			const toggle = (model, key, value) => run(() => postJson('/models', {
				action: 'toggle',
				id: model.key,
				[key]: value,
			}))

			return h('div', { className: 'dcbw-panel' }, [
				h('div', { className: 'dcbw-hint', key: 'intro' }, t('models.intro')),
				// The baseline catalog exists so the selector works before the first
				// refresh, but every multiplier in it is blank. Say so, instead of
				// letting a table of em-dashes imply upstream reported nothing.
				catalog.source !== 'official'
					? h('div', { className: 'dcbw-hint', key: 'snapshot' }, t('models.snapshotWarning'))
					: null,
				h('div', { className: 'dcbw-card', key: 'meta' }, [
					h('div', { className: 'dcbw-row', key: 'row' }, [
						h('div', { className: 'dcbw-grow', key: 'info' }, [
							h('div', { className: 'dcbw-hint', key: 'src' }, [
								`${t('models.source')}：`,
								catalog.source === 'official'
									? t('models.sourceOfficial')
									: t('models.sourceBuiltin'),
							].join('')),
							h('div', { className: 'dcbw-hint', key: 'up' },
								`${t('models.updatedAt')}：${formatTime(catalog.updatedAt)}`),
						]),
						h('button', {
							key: 'btn',
							type: 'button',
							className: 'dcbw-btn',
							'data-primary': 'true',
							disabled: busy,
							onClick: refresh,
						}, busy ? t('models.refreshing') : t('models.refresh')),
					]),
				]),
				models.length
					? h('div', { className: 'dcbw-models', key: 'list' }, models.map((model) => h('div', {
						key: model.key,
						className: 'dcbw-model',
						'data-off': model.enabled ? 'false' : 'true',
					}, [
						h('div', { className: 'dcbw-model-name', key: 'name' }, [
							h('span', { key: 'n' }, model.name),
							model.needUpgrade
								? h('span', {
									className: 'dcbw-tag',
									key: 'u',
									style: { marginLeft: '6px' },
								}, t('models.needUpgrade'))
								: null,
						]),
						h('span', {
							key: 'rate',
							className: 'dcbw-rate',
							'data-tone': rateTone(model),
							// The tooltip carries the upstream wording when there is one,
							// and says "not reported" when there is not — never the bare
							// label "积分倍率", which reads like a value that failed.
							title: model.rateText || t('models.rateUnknown'),
						}, model.rateToken || model.rateText || (model.free ? t('models.free') : '—')),
						h('div', { className: 'dcbw-model-meta', key: 'meta' }, [
							model.window ? `${Math.round(model.window / 1000)}K` : '',
							model.levels?.length ? ` · ${model.levels.join('/')}` : '',
						].join('')),
						h('div', { className: 'dcbw-row', key: 'switches' }, [
							h('span', { className: 'dcbw-hint', key: 'l1' }, t('models.enabled')),
							h(Switch, {
								key: 's1',
								on: model.enabled,
								label: `${model.name} ${t('models.enabled')}`,
								disabled: busy || model.needUpgrade,
								onChange: (on) => toggle(model, 'enabled', on),
							}),
							h('span', { className: 'dcbw-hint', key: 'l2' }, t('models.image')),
							h(Switch, {
								key: 's2',
								on: model.image,
								label: `${model.name} ${t('models.image')}`,
								disabled: busy || model.needUpgrade,
								onChange: (on) => toggle(model, 'image', on),
							}),
						]),
					])))
					: h('div', { className: 'dcbw-hint', key: 'empty' }, t('models.noModels')),
			])
		}

		/* ------------------------------------------------------------------ *
		 * Settings section
		 * ------------------------------------------------------------------ */

		function SettingsSection() {
			const [tab, setTab] = React.useState('account')
			const [data, setData] = React.useState(null)
			const [busy, setBusy] = React.useState(false)
			const [error, setError] = React.useState('')
			const [notice, setNotice] = React.useState('')
			const alive = React.useRef(true)
			const busyRef = React.useRef(false)

			React.useEffect(() => {
				alive.current = true
				void load()
				return () => { alive.current = false }
			}, [])

			async function load() {
				try {
					const next = await getJson('/snapshot')
					if (alive.current) setData(next)
				} catch (cause) {
					if (alive.current) setError(cause?.message ?? t('common.failed'))
				}
			}

			/** One write at a time so two clicks cannot interleave state changes. */
			async function run(operation) {
				if (busyRef.current) return
				busyRef.current = true
				setBusy(true)
				setError('')
				setNotice('')
				try {
					const note = await operation()
					if (alive.current) {
						if (note) setNotice(String(note))
						await load()
					}
				} catch (cause) {
					if (alive.current) setError(cause?.message ?? t('common.failed'))
				} finally {
					busyRef.current = false
					if (alive.current) setBusy(false)
				}
			}

			const body = data === null
				? h('div', { className: 'dcbw-hint' }, t('common.loading'))
				: tab === 'account'
					? h(AccountsTab, { data, busy, run })
					: h(ModelsTab, { data, busy, run })

			return h('div', { className: 'dcbw-root' }, [
				h(PluginStyle, { key: 'style' }),
				h('div', { className: 'dcbw-tabs', key: 'tabs', role: 'tablist' }, [
					h('button', {
						key: 'account',
						type: 'button',
						role: 'tab',
						id: 'dcbw-tab-account',
						'aria-selected': tab === 'account' ? 'true' : 'false',
						'aria-controls': 'dcbw-panel-account',
						className: 'dcbw-tab',
						'data-on': tab === 'account' ? 'true' : 'false',
						onClick: () => setTab('account'),
					}, t('tab.account')),
					h('button', {
						key: 'models',
						type: 'button',
						role: 'tab',
						id: 'dcbw-tab-models',
						'aria-selected': tab === 'models' ? 'true' : 'false',
						'aria-controls': 'dcbw-panel-models',
						className: 'dcbw-tab',
						'data-on': tab === 'models' ? 'true' : 'false',
						onClick: () => setTab('models'),
					}, t('tab.models')),
				]),
				error ? h('div', { className: 'dcbw-err', key: 'err' }, error) : null,
				notice ? h('div', { className: 'dcbw-ok', key: 'ok' }, notice) : null,
				h('div', {
					key: 'body',
					role: 'tabpanel',
					id: `dcbw-panel-${tab}`,
					'aria-labelledby': `dcbw-tab-${tab}`,
					tabIndex: -1,
				}, body),
			])
		}

		/* ------------------------------------------------------------------ *
		 * Composer pill
		 * ------------------------------------------------------------------ */

		function ComposerPill() {
			const [data, setData] = React.useState(null)
			const [open, setOpen] = React.useState(false)
			const [anchor, setAnchor] = React.useState(null)
			const buttonRef = React.useRef(null)

			React.useEffect(() => {
				let stopped = false
				let timer
				const poll = async () => {
					try {
						const next = await getJson('/pill')
						if (!stopped) setData(next)
					} catch {
						// The plugin may be stopped; silence beats an error in the composer.
					}
					if (!stopped) timer = setTimeout(poll, 60000)
				}
				void poll()
				return () => {
					stopped = true
					if (timer) clearTimeout(timer)
				}
			}, [])

			React.useEffect(() => {
				if (!open) return undefined
				const onDown = (event) => {
					if (buttonRef.current && buttonRef.current.contains(event.target)) return
					setOpen(false)
				}
				const onKey = (event) => { if (event.key === 'Escape') setOpen(false) }
				document.addEventListener('mousedown', onDown)
				document.addEventListener('keydown', onKey)
				return () => {
					document.removeEventListener('mousedown', onDown)
					document.removeEventListener('keydown', onKey)
				}
			}, [open])

			if (!data?.hasAccount) return null

			const remaining = data.remaining
			const label = typeof remaining === 'number'
				? `${formatNumber(remaining)} ${t('composer.remaining')}`
				: t('composer.remaining')
			const checkinText = data.checkedIn
				? t('composer.checkedIn')
				: t('composer.notCheckedIn')

			const toggle = () => {
				const rect = buttonRef.current?.getBoundingClientRect()
				if (rect) setAnchor({ left: rect.left, top: rect.top - 6 })
				setOpen(!open)
			}

			const rows = [
				h('div', { className: 'dcbw-pop-row', key: 'a' }, [
					h('span', { key: 'k' }, t('composer.account')),
					h('span', { key: 'v' }, data.accountLabel || '—'),
				]),
				h('div', { className: 'dcbw-pop-row', key: 'r' }, [
					h('span', { key: 'k' }, t('credits.remaining')),
					// A null remainder is "not reported", never zero.
					h('span', { key: 'v' }, formatNumber(remaining)),
				]),
			]
			if (typeof data.windowTotal === 'number') {
				rows.push(h('div', { className: 'dcbw-pop-row', key: 'w' }, [
					h('span', { key: 'k' }, data.windowName || t('credits.quotaWindow')),
					h('span', { key: 'v' }, [
						formatNumber(data.windowRemaining),
						' / ',
						formatNumber(data.windowTotal),
					].join('')),
				]))
			}
			if (data.quotaUpdatedAt) {
				rows.push(h('div', { className: 'dcbw-pop-row', key: 'u' }, [
					h('span', { key: 'k' }, t('credits.updatedAt')),
					h('span', { key: 'v' }, formatTime(data.quotaUpdatedAt)),
				]))
			}
			rows.push(h('div', { className: 'dcbw-pop-row', key: 'c' }, [
				h('span', { key: 'k' }, t('credits.checkin')),
				h('span', { key: 'v' }, [
					checkinText,
					typeof data.continuousDays === 'number'
						? ` · ${data.continuousDays}${t('credits.days')}`
						: '',
				].join('')),
			]))
			if (data.poolEnabled && data.accountCount > 1) {
				rows.push(h('div', { className: 'dcbw-pop-row', key: 'p' }, [
					h('span', { key: 'k' }, t('composer.pool')),
					h('span', { key: 'v' }, `${data.accountCount} ${t('composer.accounts')}`),
				]))
			}

			const popover = open && anchor
				? ReactDOM.createPortal(h('div', {
					className: 'dcbw-pop',
					style: {
						left: `${anchor.left}px`,
						top: `${anchor.top}px`,
						transform: 'translateY(-100%)',
					},
				}, rows), document.body)
				: null

			return h(React.Fragment, null, [
				h('style', { key: 'style', 'data-plugin': 'dsh-doubaowork-connect-pop' }, CSS),
				h('div', { className: 'dcbw-pill', key: 'pill' }, [
					h('button', {
						key: 'btn',
						ref: buttonRef,
						type: 'button',
						className: 'dcbw-pill-btn',
						title: t('composer.open'),
						'aria-label': t('composer.open'),
						'aria-expanded': open ? 'true' : 'false',
						onClick: toggle,
					}, label),
				]),
				popover,
			])
		}

		/* ------------------------------------------------------------------ *
		 * Registration
		 * ------------------------------------------------------------------ */

		return {
			name: 'dsh-doubaowork-connect-client',
			inject: ['slots'],
			apply(ctx) {
				const disposers = []

				const section = () => ctx.slots.register({
					name: 'settings.section',
					id: 'dsh-doubaowork-connect',
					order: 36,
					label: () => t('title'),
				}, SettingsSection)

				const pill = () => ctx.slots.register({
					name: 'conversation.input.right',
					id: 'dsh-doubaowork-connect-pill',
					order: 4,
				}, ComposerPill)

				disposers.push(ctx.slots.inject('settings.section', section))
				disposers.push(ctx.slots.inject('conversation.input.right', pill))

				ctx.effect(() => () => {
					for (const dispose of disposers) {
						try { dispose?.() } catch { /* already gone */ }
					}
				}, 'dsh-doubaowork-connect: slot registrations')
			},
		}
	},
})
