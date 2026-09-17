/**
 * CalDAV 客户端 - VEVENT 专用版本
 * 只处理日历事件（VEVENT），不处理待办事项（VTODO）
 * 包含所有依赖，无需额外文件
 */

const { XMLParser } = require('fast-xml-parser');

// ============================================
// XML 解析器配置
// ============================================
const xmlParser = new XMLParser({
    ignoreAttributes: false,
    removeNSPrefix: true,
    parseTagValue: false,
    trimValues: true,
});

// ============================================
// 常量定义
// ============================================
const NAMESPACES = {
    DAV: 'DAV:',
    CALDAV: 'urn:ietf:params:xml:ns:caldav',
    ICAL: 'http://apple.com/ns/ical/',
    CALSERVER: 'http://calendarserver.org/ns/'
};

const componentType = 'VEVENT';

// ============================================
// 解析工具函数
// ============================================

/**
 * 确保输入为数组
 */
const ensureArray = (arg) => Array.isArray(arg) ? arg : [arg];

/**
 * 反转义 ICS 文本值
 */
function unescapeICS(str) {
    if (!str) return str;
    return str.replace(/\\n/gi, '\n')
        .replace(/\\,/g, ',')
        .replace(/\\;/g, ';')
        .replace(/\\\\/g, '\\');
}

/**
 * 通用属性提取函数
 */
function extractPropHref(jsonData, propName) {
    if (!jsonData.multistatus?.response) return null;
    const responses = ensureArray(jsonData.multistatus.response);

    for (const response of responses) {
        const propstats = ensureArray(response.propstat || []);
        for (const propstat of propstats) {
            const prop = propstat.prop?.[propName];
            if (prop?.href) {
                return typeof prop.href === 'string'
                    ? prop.href
                    : prop.href['#text'] || prop.href;
            }
        }
    }
    return null;
}

/**
 * 解析 WebDAV 的 Multi-Status (207) 响应
 * WebDAV 返回的是一个复杂的 XML 树，包含多个资源的状态。
 * 这个函数遍历所有响应，提取 propstat 中的属性。
 * @param {Object} jsonData - 解析后的 XML JSON 对象
 * @param {Function} callback - 对每个资源的属性进行处理的回调函数
 */
function parseMultiStatus(jsonData, callback) {
    if (!jsonData.multistatus?.response) return [];

    const responses = ensureArray(jsonData.multistatus.response);
    const results = [];

    for (const response of responses) {
        if (!response.propstat) continue;
        const propstats = ensureArray(response.propstat);

        for (const propstat of propstats) {
            if (!propstat.prop) continue;
            const result = callback(response, propstat.prop);
            if (result) results.push(result);
        }
    }

    return results;
}

/**
 * 解析日历列表
 * 从 PROPFIND 响应中提取日历的元数据（名称、颜色、支持的组件等）
 */
function parseCalendars(jsonData) {
    return parseMultiStatus(jsonData, (response, prop) => {
        const url = response.href;

        if (!prop.resourcetype) return null;

        const isCalendar = prop.resourcetype.calendar !== undefined;
        if (!isCalendar) return null;

        const components = [];
        if (prop['supported-calendar-component-set']?.comp) {
            const comp = prop['supported-calendar-component-set'].comp;
            const compArray = ensureArray(comp);
            compArray.forEach(c => {
                if (c['@_name']) components.push(c['@_name']);
            });
        }

        const id = extractCalendarId(url);
        return {
            id: id,
            url: url,
            displayName: prop.displayname || '未命名',
            color: prop['calendar-color'] || null,
            components: components,
        };
    });
}

/**
 * 从 URL 中提取日历 ID
 * 例如: /calendars/user/calendar-id/ -> calendar-id
 */
function extractCalendarId(url) {
    const match = url.match(/\/calendars\/([^\/]+)\/?$/);
    return match ? match[1] : url;
}

/**
 * 提取当前用户的 Principal URL (主体地址)
 * 这是 CalDAV 服务发现的第一步
 */
function extractPrincipal(jsonData) {
    return extractPropHref(jsonData, 'current-user-principal');
}

/**
 * 提取用户的 Calendar Home Set URL (日历主目录)
 * 这是 CalDAV 服务发现的第二步，所有的日历都存放在这个目录下
 */
function extractCalendarHome(jsonData) {
    return extractPropHref(jsonData, 'calendar-home-set');
}



/**
 * 将 Date 对象转换为本地时间字符串
 * 格式: YYYY-MM-DD HH:mm:ss
 */
function formatDateToLocalString(date) {
    if (!date) return null;

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');

    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

/**
 * 解析 ICS 日期字符串
 * 支持:
 * - YYYYMMDD
 * - YYYYMMDDTHHMMSS
 * - YYYYMMDDTHHMMSSZ
 * - YYYYMMDDTHHMMSS+0800 / -0800
 * 返回本地时间字符串格式: 'YYYY-MM-DD HH:mm:ss'
 */
function parseICSDate(dateStr, keyPart = '') {
    if (!dateStr || typeof dateStr !== 'string') return null;

    const trimmed = dateStr.trim();
    if (!trimmed) return null;

    // 纯日期（全天事件），或显式 VALUE=DATE
    const isDateOnly = /(?:^|;)VALUE=DATE(?:;|$)/i.test(keyPart) || !trimmed.includes('T');
    const dateOnlyMatch = trimmed.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (isDateOnly && dateOnlyMatch) {
        const [, year, month, day] = dateOnlyMatch;
        const date = new Date(`${year}-${month}-${day}T00:00:00`);
        return formatDateToLocalString(date);
    }

    const dateTimeMatch = trimmed.match(
        /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z|[+-]\d{4})?$/i,
    );
    if (!dateTimeMatch) {
        return null;
    }

    const [, year, month, day, hour, minute, second, suffix] = dateTimeMatch;

    let date;
    if (!suffix) {
        // 无时区后缀属于 floating time（如 DTSTART;TZID=Asia/Shanghai）
        // 不能强行按 UTC 解析，否则会产生 +8h 偏移。
        date = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}`);
    } else if (suffix.toUpperCase() === 'Z') {
        date = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`);
    } else {
        const offset = `${suffix.slice(0, 3)}:${suffix.slice(3, 5)}`;
        date = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}${offset}`);
    }

    if (Number.isNaN(date.getTime())) {
        return null;
    }

    return formatDateToLocalString(date);
}



/**
 * 解析 VEVENT (事件) 的 ICS 数据
 * 将 ICS 文本格式转换为 JavaScript 对象
 */
function parseVEvent(icsData) {
    const event = {
        uid: null,
        summary: null,
        description: null,
        location: null,
        startDate: null,
        endDate: null,
        created: null,
        lastModified: null,
        completed: null,
    };

    // 解析 RRULE 字符串为对象
    function parseRRule(rruleStr) {
        if (!rruleStr || typeof rruleStr !== 'string') return null;
        const parts = rruleStr.split(';');
        const rule = {};
        for (const part of parts) {
            const eqIndex = part.indexOf('=');
            if (eqIndex === -1) continue;
            const k = part.substring(0, eqIndex).toUpperCase();
            const v = part.substring(eqIndex + 1);
            if (!k || !v) continue;
            switch (k) {
                case 'FREQ': rule.frequency = v.toUpperCase(); break;
                case 'INTERVAL': rule.interval = parseInt(v, 10); break;
                case 'COUNT': rule.count = parseInt(v, 10); break;
                case 'UNTIL': rule.until = parseICSDate(v, ''); break;
                case 'BYDAY': rule.byDay = v.split(','); break;
                case 'BYMONTH': rule.byMonth = v.split(',').map((x) => parseInt(x, 10)); break;
                case 'BYMONTHDAY': rule.byMonthDay = v.split(',').map((x) => parseInt(x, 10)); break;
                case 'WKST': rule.weekStart = v.toUpperCase(); break;
            }
        }
        if (!rule.frequency) return null;
        return rule;
    }

    // 解析 VALARM 块内行，提取提前分钟数
    function parseAlarmLines(blockLines) {
        let minutes = null;
        let action = null;
        let description = null;
        for (const rawLine of blockLines) {
            const t = rawLine.trim();
            if (!t) continue;
            const colon = t.indexOf(':');
            if (colon === -1) continue;
            const k = t.substring(0, colon).split(';')[0].toUpperCase();
            const v = t.substring(colon + 1);
            if (k === 'TRIGGER') {
                const m = v.match(/^(-?)P(?:T)?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i);
                if (m) {
                    const sign = m[1] === '-' ? -1 : 1;
                    const h = parseInt(m[2] || '0', 10);
                    const min = parseInt(m[3] || '0', 10);
                    const s = parseInt(m[4] || '0', 10);
                    minutes = sign * (h * 60 + min + Math.round(s / 60));
                }
            } else if (k === 'ACTION') {
                action = v.toUpperCase();
            } else if (k === 'DESCRIPTION') {
                description = v;
            }
        }
        if (minutes === null) return null;
        return { minutes, action: action || 'DISPLAY', description };
    }

    // VALARM 块收集状态
    let inAlarm = false;
    let alarmLines = [];
    // VEVENT 组件边界：只解析 VEVENT 块内的属性，
    // 跳过 VTIMEZONE（Apple 生成的时区定义内含大量历史 DTSTART 行，
    // 如中国 1987 年夏令时 19870412T020000，不跳过会覆盖真实事件时间）
    let inVEvent = false;

    // 处理 ICS 换行 (Line Folding): 移除 CRLF 后跟的空格或 Tab
    const unfolded = icsData.replace(/\r?\n[ \t]/g, '');
    const lines = unfolded.split(/\r?\n/);

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        // 查找第一个冒号的位置
        const colonIndex = trimmed.indexOf(':');
        if (colonIndex === -1) continue;

        const keyPart = trimmed.substring(0, colonIndex);
        const value = trimmed.substring(colonIndex + 1);

        // 提取属性名 (去除参数, 如 DTSTART;TZID=...)
        const key = keyPart.split(';')[0];

        // 组件边界：仅处理 VEVENT 块内的行
        if (!inVEvent) {
            if (key === 'BEGIN' && value.toUpperCase() === 'VEVENT') {
                inVEvent = true;
            }
            continue;
        }
        if (key === 'END' && value.toUpperCase() === 'VEVENT') {
            inVEvent = false;
            continue;
        }

        switch (key) {
            case 'UID': event.uid = value; break;
            case 'SUMMARY': event.summary = unescapeICS(value); break;
            case 'DESCRIPTION': event.description = unescapeICS(value); break;
            case 'LOCATION': event.location = unescapeICS(value); break;
            case 'DTSTART': event.startDate = parseICSDate(value, keyPart); break;
            case 'DTEND': event.endDate = parseICSDate(value, keyPart); break;
            case 'CREATED': event.created = parseICSDate(value, keyPart); break;
            case 'LAST-MODIFIED': event.lastModified = parseICSDate(value, keyPart); break;
            case 'COMPLETED': event.completed = parseICSDate(value, keyPart); break;
            case 'STATUS': event.status = value.toUpperCase(); break;
            case 'PRIORITY': {
                const p = parseInt(value, 10);
                if (!Number.isNaN(p)) event.priority = p;
                break;
            }
            case 'CATEGORIES':
                event.categories = value.split(',').map((c) => c.trim()).filter(Boolean);
                break;
            case 'URL': event.url = value; break;
            case 'RRULE': event.recurrence = parseRRule(value); break;
        }

        // 收集 VALARM 块内容
        if (inAlarm) {
            if (key === 'END' && value.toUpperCase() === 'VALARM') {
                const alarm = parseAlarmLines(alarmLines);
                if (alarm) {
                    if (!event.alarms) event.alarms = [];
                    event.alarms.push(alarm);
                }
                inAlarm = false;
                alarmLines = [];
            } else if (key !== 'BEGIN') {
                alarmLines.push(trimmed);
            }
        } else if (key === 'BEGIN' && value.toUpperCase() === 'VALARM') {
            inAlarm = true;
            alarmLines = [];
        }
    }

    // 兜底：如果 VALARM 块未正常闭合
    if (inAlarm && alarmLines.length > 0) {
        const alarm = parseAlarmLines(alarmLines);
        if (alarm) {
            if (!event.alarms) event.alarms = [];
            event.alarms.push(alarm);
        }
    }

    return event;
}

/**
 * 从 REPORT 响应中解析事件列表
 * 提取 href, etag 和 calendar-data (ICS)
 */
function parseEventsFromReport(jsonData) {
    return parseMultiStatus(jsonData, (response, prop) => {
        if (prop['calendar-data'] && prop['calendar-data'].includes('BEGIN:VEVENT')) {
            const event = parseVEvent(prop['calendar-data']);
            event.url = response.href;
            // 去除 etag 值中的引号
            const etag = prop.getetag || null;
            event.etag = etag ? etag.replace(/^"|"$/g, '') : null;
            return event;
        }
        return null;
    });
}

// ============================================
// CalDAV 客户端主类
// ============================================
/**
 * CalDAV 客户端主类
 * 封装了所有与 CalDAV 服务器交互的逻辑
 */
class CalDAVClient {
    /**
     * 初始化客户端
     * @param {string} username - iCloud 邮箱
     * @param {string} password - 应用专用密码
     */
    constructor(username, password) {
        this.username = username;
        this.password = password;
        this.serverUrl = "https://caldav.icloud.com";
        this.calendars = [];
        this.calendarHomeUrl = null;
        this.authHeader = `Basic ${btoa(`${username}:${password}`)}`;
    }

    /**
     * 发送 HTTP 请求的通用包装器
     * 自动处理 Basic Auth 认证头和 XML 响应解析
     */
    async request(method, url, options = {}) {
        const {
            depth = null,
            body = null,
            contentType = 'application/xml; charset=utf-8'
        } = options;

        const headers = {
            'Authorization': this.authHeader,
            'Content-Type': contentType,
        };

        if (depth) {
            headers['Depth'] = depth;
        }

        try {
            const response = await fetch(url, {
                method,
                headers,
                body,
            });

            if (!response.ok) {
                throw new Error(`${method} failed: ${response.status} ${response.statusText}`);
            }

            const xmlText = await response.text();
            const json = xmlText ? xmlParser.parse(xmlText) : {};

            return {
                xml: xmlText,
                json: json,
                status: response.status
            };

        } catch (error) {
            console.error(`[CalDAV] ${method} 请求失败:`, error.message);
            throw error;
        }
    }

    /**
     * 发送 PROPFIND 请求
     * 用于获取资源属性,depth = 0表示获取第一层，=1表示获取更深的层
     */
    async propfind(url, depth = '0', customBody = null) {
        const defaultBody = `<?xml version="1.0" encoding="utf-8" ?>
<d:propfind xmlns:d="${NAMESPACES.DAV}" xmlns:c="${NAMESPACES.CALDAV}" xmlns:a="${NAMESPACES.ICAL}">
  <d:prop>
    <d:displayname />
    <d:resourcetype />
    <c:supported-calendar-component-set />
    <d:current-user-principal />
    <c:calendar-home-set />
    <a:calendar-color />
  </d:prop>
</d:propfind>`;
        return await this.request('PROPFIND', url, {
            depth,
            body: customBody || defaultBody
        });
    }

    /**
     * 发送 REPORT 请求
     * 用于查询日历数据,depth = 1表示获取更深的层
     */
    async report(url, body) {
        return await this.request('REPORT', url, {
            depth: '1',
            body
        });
    }

    /**
     * 发送 PUT 请求
     * 用于创建或更新资源
     */
    async put(url, icsData) {
        return await this.request('PUT', url, {
            body: icsData,
            contentType: 'text/calendar; charset=utf-8'
        });
    }

    /**
     * 发送 DELETE 请求
     * 用于删除资源
     */
    async delete(url) {
        return await this.request('DELETE', url);
    }

    /**
     * 发送 MKCALENDAR 请求
     * 用于创建新日历集合
     */
    async mkcalendar(url, body) {
        return await this.request('MKCALENDAR', url, {
            body
        });
    }

    /**
     * 发送 PROPPATCH 请求
     * 用于更新资源属性
     */
    async proppatch(url, body) {
        return await this.request('PROPPATCH', url, {
            body
        });
    }
    /**
     * 登录并执行服务发现
     * 1. 查询服务器根路径，获取 current-user-principal
     * 2. 查询 principal，获取 calendar-home-set
     * 3. 保存 calendar-home-set 用于后续操作
     */
    async login() {
        if (!this.calendarHomeUrl) {
            const principalResult = await this.propfind(this.serverUrl, '0');
            const principalUrl = extractPrincipal(principalResult.json);
            const absolutePrincipalUrl = this._makeAbsoluteUrl(principalUrl);
            const calHomeResult = await this.propfind(absolutePrincipalUrl, '0');
            this.calendarHomeUrl = extractCalendarHome(calHomeResult.json);
            if (!this.calendarHomeUrl) {
                return {
                    success: false,
                    error: '无法获取iCloud地址'
                };
            }
        }
        return {
            success: true,
            calendarHomeUrl: this.calendarHomeUrl
        };
    }
    /**
     * 获取日历列表
     * 发送 PROPFIND 请求获取所有日历及其属性
     * 只返回支持 VEVENT（事件）的日历
     */
    async getCalendars() {
        const calendarsResult = await this.propfind(this.calendarHomeUrl, '1');
        const allCalendars = parseCalendars(calendarsResult.json);

        // 只保留支持 VEVENT 的日历
        const eventCalendars = allCalendars.filter(cal => cal.components.includes('VEVENT'));

        // 更新缓存
        this.calendars = eventCalendars;

        return eventCalendars;
    }
    /**
     * 获取单个日历的详细信息
     * 包括 CTag (版本号)、所有者、权限等
     */
    async getCalendarDetails(calendar) {
        const calendarUrl = this._makeAbsoluteUrl(calendar.url);
        const detailBody = `<?xml version="1.0" encoding="utf-8" ?>
<d:propfind xmlns:d="${NAMESPACES.DAV}" xmlns:cs="${NAMESPACES.CALSERVER}" xmlns:c="${NAMESPACES.CALDAV}">
  <d:prop>
    <d:displayname />
    <cs:getctag />
    <d:owner />
    <d:current-user-privilege-set />
  </d:prop>
</d:propfind>`;

        const result = await this.propfind(calendarUrl, '0', detailBody);
        const response = result.json.multistatus.response;
        const prop = response.propstat.prop;

        return {
            displayName: prop.displayname || calendar.displayName,
            color: calendar.color,
            ctag: prop.getctag || null,
            owner: prop.owner?.href || null,
            privileges: this._parsePrivileges(prop['current-user-privilege-set'])
        };
    }

    /**
     * 将相对 URL 转换为绝对 URL
     * 如果已经是绝对 URL 则直接返回
     */
    _makeAbsoluteUrl(url) {
        if (url.startsWith('http')) {
            return url;
        }
        return this.serverUrl + url;
    }

    /**
     * 生成 UUID
     * 优先使用 crypto.randomUUID (Node.js 14.17+), 否则使用 Math.random 回退
     */
    _generateUUID() {
        if (typeof crypto !== 'undefined' && crypto.randomUUID) {
            return crypto.randomUUID();
        }
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    /**
     * 解析日期输入
     * 将字符串或 Date 对象统一转换为 Date 对象
     */
    _parseDate(dateInput) {
        if (!dateInput) return null;
        if (dateInput instanceof Date) return dateInput;

        // 支持 "2025-11-26 07:00:00" 格式
        if (typeof dateInput === 'string') {
            const cleanStr = dateInput.trim();
            // 将空格替换为 T 以符合 ISO 8601 格式
            const isoStr = cleanStr.includes(' ') ? cleanStr.replace(' ', 'T') : cleanStr;
            const date = new Date(isoStr);
            return isNaN(date.getTime()) ? null : date;
        }
        return null;
    }

    /**
     * 格式化日期为 CalDAV 格式
     * 输出格式: YYYYMMDDTHHMMSSZ
     */
    _formatCalDAVDate(dateInput) {
        const date = this._parseDate(dateInput);
        if (!date) return null;

        // Format to YYYYMMDDTHHMMSSZ (UTC)
        const year = date.getUTCFullYear();
        const month = String(date.getUTCMonth() + 1).padStart(2, '0');
        const day = String(date.getUTCDate()).padStart(2, '0');
        const hours = String(date.getUTCHours()).padStart(2, '0');
        const minutes = String(date.getUTCMinutes()).padStart(2, '0');
        const seconds = String(date.getUTCSeconds()).padStart(2, '0');
        return `${year}${month}${day}T${hours}${minutes}${seconds}Z`;
    }

    /**
     * 格式化重复规则 (Recurrence Rule)
     * 将配置对象转换为 RRULE 字符串
     * @param {Object|String} recurrence
     */
    _formatRecurrenceRule(recurrence) {
        if (!recurrence) return null;
        if (typeof recurrence === 'string') return recurrence;

        const parts = [];

        // 频率 (必填)
        if (recurrence.frequency) {
            parts.push(`FREQ=${recurrence.frequency.toUpperCase()}`);
        }

        // 间隔
        if (recurrence.interval) {
            parts.push(`INTERVAL=${recurrence.interval}`);
        }

        // 次数
        if (recurrence.count) {
            parts.push(`COUNT=${recurrence.count}`);
        }

        // 截止日期
        if (recurrence.until) {
            const untilDate = this._formatCalDAVDate(recurrence.until);
            if (untilDate) {
                parts.push(`UNTIL=${untilDate}`);
            }
        }

        // 指定周几
        if (recurrence.byDay) {
            const days = Array.isArray(recurrence.byDay) ? recurrence.byDay.join(',') : recurrence.byDay;
            parts.push(`BYDAY=${days}`);
        }

        // 指定月份
        if (recurrence.byMonth) {
            const months = Array.isArray(recurrence.byMonth) ? recurrence.byMonth.join(',') : recurrence.byMonth;
            parts.push(`BYMONTH=${months}`);
        }

        // 指定月中的日期
        if (recurrence.byMonthDay) {
            const monthDays = Array.isArray(recurrence.byMonthDay) ? recurrence.byMonthDay.join(',') : recurrence.byMonthDay;
            parts.push(`BYMONTHDAY=${monthDays}`);
        }

        // 周开始日
        if (recurrence.weekStart) {
            parts.push(`WKST=${recurrence.weekStart}`);
        }

        return parts.join(';');
    }



    /**
     * 构建 ICS 格式字符串
     * 这是将 JavaScript 对象转换为 CalDAV 服务器可识别的格式的核心函数。
     * 支持创建新对象和更新现有对象（合并 originalData）。
     */
    _buildICS(uid, data, originalData = {}) {
        const get = (key) => data[key] ?? originalData[key];
        const timestamp = this._formatCalDAVDate(new Date());

        // 格式化日期字段
        const formatDate = (key) => {
            const date = this._parseDate(get(key));
            return date ? this._formatCalDAVDate(date) : null;
        };

        // 构建可选字段行
        const optional = (key, value) => value ? `${key}:${value}` : '';

        // 日期字段
        const dtstart = formatDate('startDate');
        const dtend = formatDate('endDate');
        const due = formatDate('due');
        const completed = formatDate('completed');
        const created = formatDate('created');
        const lastModified = formatDate('lastModified');

        // 状态字段
        const status = get('status')?.toUpperCase();

        // 数组字段
        const categories = get('categories')?.join(',');
        const exdates = get('exdates')?.map(d => this._formatCalDAVDate(new Date(d))).join(',');
        const rdates = get('rdates')?.map(d => this._formatCalDAVDate(new Date(d))).join(',');

        // 组织者和参与者
        const organizer = get('organizer') ? `ORGANIZER;CN=${get('organizer').name || ''}:mailto:${get('organizer').email}` : '';
        const attendees = get('attendees')?.map(att =>
            `ATTENDEE;CN=${att.name || ''};ROLE=${att.role || 'REQ-PARTICIPANT'};PARTSTAT=${att.status || 'NEEDS-ACTION'}:mailto:${att.email}`
        ).join('\n') || '';

        // 地理位置
        const geo = get('geo') ? `GEO:${get('geo').lat};${get('geo').lon}` : '';

        // 多个提醒
        const alarms = (get('alarms') || []).map(alarm => {
            const minutes = typeof alarm === 'number' ? alarm : alarm.minutes;
            const description = typeof alarm === 'object' ? (alarm.description || '提醒') : '提醒';
            const action = typeof alarm === 'object' ? (alarm.action || 'DISPLAY') : 'DISPLAY';

            return `BEGIN:VALARM
ACTION:${action}
TRIGGER:-PT${minutes}M
DESCRIPTION:${description}
END:VALARM`;
        }).join('\n');

        // 多个附件
        const attachments = get('attachments')?.map(att =>
            att.name
                ? `ATTACH;FMTTYPE=${att.mimeType || 'application/octet-stream'};FILENAME=${att.name}:${att.url}`
                : `ATTACH:${att.url}`
        ).join('\n') || (data.attachment?.url ? (data.attachment.name
            ? `ATTACH;FMTTYPE=application/octet-stream;FILENAME=${data.attachment.name}:${data.attachment.url}`
            : `ATTACH:${data.attachment.url}`) : '');

        // 完整模板 - 覆盖所有 CalDAV 标准字段
        const ics = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//TodoApp//CN
CALSCALE:GREGORIAN
METHOD:${get('method') || 'PUBLISH'}
BEGIN:${componentType}
UID:${uid}
DTSTAMP:${timestamp}
${optional('CREATED', created)}
${optional('LAST-MODIFIED', lastModified)}
${optional('SEQUENCE', get('sequence') || '0')}
${optional('SUMMARY', get('summary'))}
${optional('DESCRIPTION', get('description'))}
${optional('LOCATION', get('location'))}
${optional('STATUS', status)}
${optional('CLASS', get('class')?.toUpperCase())}
${optional('PRIORITY', get('priority'))}
${optional('TRANSP', get('transp')?.toUpperCase())}
${optional('URL', get('url'))}
${optional('DTSTART', dtstart)}
${optional('DTEND', dtend)}
${optional('DUE', due)}
${optional('COMPLETED', completed)}
${optional('PERCENT-COMPLETE', get('percentComplete'))}
${optional('DURATION', get('duration'))}
${optional('RRULE', this._formatRecurrenceRule(get('recurrence')) || get('recurrenceRule') || get('rrule'))}
${optional('EXDATE', exdates)}
${optional('RDATE', rdates)}
${optional('CATEGORIES', categories)}
${optional('RESOURCES', get('resources')?.join(','))}
${optional('COMMENT', get('comment'))}
${optional('CONTACT', get('contact'))}
${optional('RELATED-TO', get('relatedTo'))}
${organizer}
${attendees}
${geo}
${alarms}
${attachments}
END:${componentType}
END:VCALENDAR
`;

        // 移除空行
        return ics.split('\n').filter(line => line.trim()).join('\n') + '\n';
    }

    /**
     * 解析权限集合
     * 将 XML 格式的权限转换为简单的字符串数组
     */
    _parsePrivileges(privilegeSet) {
        if (!privilegeSet || !privilegeSet.privilege) return [];
        const privileges = Array.isArray(privilegeSet.privilege)
            ? privilegeSet.privilege
            : [privilegeSet.privilege];
        return privileges.map(p => Object.keys(p)[0]);
    }

    /**
     * 获取日历中的对象（事件）
     * 使用 REPORT 方法和 calendar-query 进行查询
     * @param {Object} calendar - 日历对象
     * @param {Object} options - 查询选项，如时间范围 {startDate, endDate}
     */
    async getCalendarObjects(calendar, options = {}) {
        if (!calendar || !calendar.url) {
            throw new Error('无效的日历对象');
        }

        let timeRangeFilter = '';
        if (options.startDate || options.endDate) {
            const start = options.startDate ? this._formatCalDAVDate(options.startDate) : '19700101T000000Z';
            const end = options.endDate ? this._formatCalDAVDate(options.endDate) : '20991231T235959Z';
            timeRangeFilter = `
        <c:time-range start="${start}" end="${end}"/>`;
        }

        const reportBody = `<?xml version="1.0" encoding="utf-8" ?>
<c:calendar-query xmlns:d="${NAMESPACES.DAV}" xmlns:c="${NAMESPACES.CALDAV}">
  <d:prop>
    <d:getetag />
    <c:calendar-data />
  </d:prop>
  <c:filter>
    <c:comp-filter name="VCALENDAR">
      <c:comp-filter name="${componentType}">${timeRangeFilter}
      </c:comp-filter>
    </c:comp-filter>
  </c:filter>
</c:calendar-query>`;

        const calendarUrl = this._makeAbsoluteUrl(calendar.url);
        const result = await this.report(calendarUrl, reportBody);

        return parseEventsFromReport(result.json);
    }



    /**
     * 按 UID 查询事件（用 UID 属性过滤而非猜测资源路径）
     * iCloud 的事件资源文件名（href）不等于 UID.ics，必须通过 REPORT 查询真实路径
     * 优先使用 CalDAV 标准的 UID 属性过滤；若服务器不支持（如 412），回退全量拉取后本地过滤
     */
    async getEventsByUid(calendar, uid) {
        if (!calendar || !calendar.url) {
            throw new Error('无效的日历对象');
        }

        const escapeXml = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

        const calendarUrl = this._makeAbsoluteUrl(calendar.url);

        // 方案 A：CalDAV 标准 UID 属性过滤查询
        try {
            const reportBody = `<?xml version="1.0" encoding="utf-8" ?>
<c:calendar-query xmlns:d="${NAMESPACES.DAV}" xmlns:c="${NAMESPACES.CALDAV}">
  <d:prop>
    <d:getetag />
    <c:calendar-data />
  </d:prop>
  <c:filter>
    <c:comp-filter name="VCALENDAR">
      <c:comp-filter name="${componentType}">
        <c:prop-filter name="UID">
          <c:text-match>${escapeXml(uid)}</c:text-match>
        </c:prop-filter>
      </c:comp-filter>
    </c:comp-filter>
  </c:filter>
</c:calendar-query>`;

            const result = await this.report(calendarUrl, reportBody);
            const events = parseEventsFromReport(result.json);
            if (events.length > 0) {
                return events;
            }
        } catch (e) {
            // 服务器不支持 UID 过滤查询，回退到方案 B
        }

        // 方案 B：全量拉取 + 本地按 UID 过滤（对小型日历开销可接受）
        const all = await this.getCalendarObjects(calendar, {});
        return (all || []).filter((e) => e.uid === uid);
    }

    /**
     * 获取单个事件
     * 通过 UID 属性过滤查询，返回真实资源路径与事件数据
     */
    async getEvent(calendar, uid) {
        const events = await this.getEventsByUid(calendar, uid);
        return events.length > 0 ? events[0] : null;
    }

    /**
     * 创建新事件
     * 生成 UUID，构建 ICS，并上传到服务器
     */
    async createEvent(calendar, eventData) {
        if (!calendar || !calendar.url) {
            throw new Error('无效的日历对象');
        }

        if (!calendar.components.includes('VEVENT')) {
            throw new Error(`日历 "${calendar.displayName}" 不支持事件`);
        }

        const uid = this._generateUUID();
        const icsData = this._buildICS(uid, eventData);



        const eventUrl = `${this._makeAbsoluteUrl(calendar.url)}${uid}.ics`;
        await this.put(eventUrl, icsData);

        return {
            uid,
            summary: eventData.summary,
            startDate: eventData.startDate,
            endDate: eventData.endDate,
            description: eventData.description || null,
            location: eventData.location || null,
            url: `${calendar.url}${uid}.ics`,
            recurrence: eventData.recurrence || null
        };
    }

    /**
     * 更新事件
     * 先获取现有事件，合并新数据，然后重新上传到真实资源路径
     */
    async updateEvent(calendar, eventUid, eventData) {
        if (!calendar || !calendar.url) {
            throw new Error('无效的日历对象');
        }

        // 优化：直接获取单个事件，而不是下载整个日历
        const existingEvent = await this.getEvent(calendar, eventUid);

        if (!existingEvent) {
            throw new Error(`未找到事件 UID: ${eventUid}`);
        }

        const icsData = this._buildICS(eventUid, eventData, existingEvent);

        // 上传到真实资源路径（iCloud 的资源文件名不等于 UID.ics）
        const eventUrl = existingEvent.url
            ? this._makeAbsoluteUrl(existingEvent.url.startsWith('/') ? existingEvent.url : `/${existingEvent.url}`)
            : `${this._makeAbsoluteUrl(calendar.url)}${eventUid}.ics`;
        await this.put(eventUrl, icsData);
    }

    /**
     * 删除事件
     * 先按 UID 查询真实资源路径，再发送 DELETE 请求
     */
    async deleteEvent(calendar, eventUid) {
        if (!calendar || !calendar.url) {
            throw new Error('无效的日历对象');
        }

        let eventUrl = `${this._makeAbsoluteUrl(calendar.url)}${eventUid}.ics`;
        try {
            // iCloud 资源文件名不等于 UID.ics，必须先查询真实路径
            const events = await this.getEventsByUid(calendar, eventUid);
            if (events.length > 0 && events[0].url) {
                const href = events[0].url;
                eventUrl = this._makeAbsoluteUrl(href.startsWith('/') ? href : `/${href}`);
            }
        } catch (e) {
            // 查询失败时退回 UID.ics 猜测路径，由后续 DELETE 返回的 404 走原有容错逻辑
        }
        await this.delete(eventUrl);
    }

    /**
     * 创建新日历
     * 使用 MKCALENDAR 方法
     */
    async createCalendar(displayName, color = '#3B82F6FF') {
        const calendarId = this._generateUUID();
        const calendarUrl = `${this.calendarHomeUrl}${calendarId}/`;

        // Build component set XML
        const componentSet = `        <c:comp name="VEVENT"/>`;

        const mkcalendarBody = `<?xml version="1.0" encoding="utf-8" ?>
<c:mkcalendar xmlns:d="${NAMESPACES.DAV}" xmlns:c="${NAMESPACES.CALDAV}" xmlns:a="${NAMESPACES.ICAL}">
  <d:set>
    <d:prop>
      <d:displayname>${displayName}</d:displayname>
      <a:calendar-color>${color}</a:calendar-color>
      <c:supported-calendar-component-set>
${componentSet}
      </c:supported-calendar-component-set>
    </d:prop>
  </d:set>
</c:mkcalendar>`;

        await this.mkcalendar(calendarUrl, mkcalendarBody);

        const calendarsResult = await this.propfind(this.calendarHomeUrl, '1');
        this.calendars = parseCalendars(calendarsResult.json);

        return this.calendars.find(cal => cal.id === calendarId);
    }

    /**
     * 删除日历
     * 发送 DELETE 请求删除整个日历集合
     */
    async deleteCalendar(calendar) {
        if (!calendar || !calendar.url) {
            throw new Error('无效的日历对象');
        }
        const calendarUrl = this._makeAbsoluteUrl(calendar.url);
        await this.delete(calendarUrl);
        const calendarsResult = await this.propfind(this.calendarHomeUrl, '1');
        this.calendars = parseCalendars(calendarsResult.json);
    }

    /**
     * 更新日历属性
     * 使用 PROPPATCH 方法更新日历名称或颜色
     */
    async updateCalendar(calendar, { name, color }) {
        if (!calendar || !calendar.url) {
            throw new Error('无效的日历对象');
        }

        const calendarUrl = this._makeAbsoluteUrl(calendar.url);

        let propUpdates = '';
        if (name) {
            propUpdates += `<d:displayname>${name}</d:displayname>`;
        }
        if (color) {
            propUpdates += `<a:calendar-color xmlns:a="${NAMESPACES.ICAL}">${color}</a:calendar-color>`;
        }

        if (!propUpdates) {
            return;
        }

        const proppatchBody = `<?xml version="1.0" encoding="utf-8" ?>
<d:propertyupdate xmlns:d="${NAMESPACES.DAV}">
  <d:set>
    <d:prop>
      ${propUpdates}
    </d:prop>
  </d:set>
</d:propertyupdate>`;

        await this.proppatch(calendarUrl, proppatchBody);

        // Refresh calendars list
        const calendarsResult = await this.propfind(this.calendarHomeUrl, '1');
        this.calendars = parseCalendars(calendarsResult.json);
    }

    /**
     * 同步日历
     * 使用 CTag (Collection Tag) 检测日历是否有变化。
     * 如果 CTag 与上次一致，则无需重新获取数据，极大提高性能。
     */
    async syncCalendar(calendar, lastCtag = null) {
        const details = await this.getCalendarDetails(calendar);
        const currentCtag = details.ctag;

        if (lastCtag && lastCtag === currentCtag) {
            return {
                hasChanges: false,
                ctag: currentCtag,
                message: '日历无变化'
            };
        }

        const events = calendar.components.includes('VEVENT')
            ? await this.getCalendarObjects(calendar)
            : [];

        return {
            hasChanges: true,
            ctag: currentCtag,
            events: events,
            message: `同步成功，获取到 ${events.length} 个事件`
        };
    }


}

module.exports = { CalDAVClient };