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
 * 支持 'YYYYMMDD' 和 'YYYYMMDDTHHMMSSZ' 格式
 * 返回本地时间字符串格式: 'YYYY-MM-DD HH:mm:ss'
 */
function parseICSDate(dateStr) {
    if (!dateStr || dateStr.length < 8) return null;

    const year = dateStr.substring(0, 4);
    const month = dateStr.substring(4, 6);
    const day = dateStr.substring(6, 8);

    let date;
    if (dateStr.includes('T')) {
        const hour = dateStr.substring(9, 11);
        const minute = dateStr.substring(11, 13);
        const second = dateStr.substring(13, 15);
        // ICS 格式是 UTC 时间，需要转换为本地时间
        date = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`);
    } else {
        date = new Date(`${year}-${month}-${day}`);
    }

    // 转换为本地时间字符串
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
    };

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

        switch (key) {
            case 'UID': event.uid = value; break;
            case 'SUMMARY': event.summary = unescapeICS(value); break;
            case 'DESCRIPTION': event.description = unescapeICS(value); break;
            case 'LOCATION': event.location = unescapeICS(value); break;
            case 'DTSTART': event.startDate = parseICSDate(value); break;
            case 'DTEND': event.endDate = parseICSDate(value); break;
            case 'CREATED': event.created = parseICSDate(value); break;
            case 'LAST-MODIFIED': event.lastModified = parseICSDate(value); break;
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
     * 获取单个事件
     * 使用 calendar-multiget REPORT 只获取指定 UID 的事件
     * 性能优化：O(1) 复杂度
     */
    async getEvent(calendar, uid) {
        if (!calendar || !calendar.url) {
            throw new Error('无效的日历对象');
        }

        // 构造事件的相对路径 (href)
        const eventPath = `${calendar.url}${uid}.ics`;

        const reportBody = `<?xml version="1.0" encoding="utf-8" ?>
<c:calendar-multiget xmlns:d="${NAMESPACES.DAV}" xmlns:c="${NAMESPACES.CALDAV}">
  <d:prop>
    <d:getetag />
    <c:calendar-data />
  </d:prop>
  <d:href>${eventPath}</d:href>
</c:calendar-multiget>`;

        const calendarUrl = this._makeAbsoluteUrl(calendar.url);
        const result = await this.report(calendarUrl, reportBody);

        const events = parseEventsFromReport(result.json);
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
     * 先获取现有事件，合并新数据，然后重新上传
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

        const eventUrl = `${this._makeAbsoluteUrl(calendar.url)}${eventUid}.ics`;
        await this.put(eventUrl, icsData);
    }

    /**
     * 删除事件
     * 发送 DELETE 请求
     */
    async deleteEvent(calendar, eventUid) {
        if (!calendar || !calendar.url) {
            throw new Error('无效的日历对象');
        }

        const eventUrl = `${this._makeAbsoluteUrl(calendar.url)}${eventUid}.ics`;
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