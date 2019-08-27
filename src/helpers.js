/**
 * Возвращает тип значения.
 * @param value значение
 * @return function
 */

export function getType (value) {
    if (value instanceof Date) {
        return Date;
    } else if (Array.isArray(value)) {
        return Array;
    } else if (isPlainObject(value)) {
        return Object;
    } else {
        return {
            number: Number,
            string: String,
            boolean: Boolean,
        }[typeof value] || '';
    }
}

/**
 * Объект является простым?
 * @param object проверяемый объект.
 * @return bool
 */

export function isPlainObject (object) {
    if (typeof object == 'object' && object !== null) {
        const prototype = Object.getPrototypeOf(object);
        return prototype === Object.prototype || prototype === null;
    } else
        return false;
}

/**
 * Возвращает имя свойства на основе текста.
 * @param text текст.
 */

export function textToProperty (text) {
    const uc = text.split('-').map(item => item.charAt(0).toUpperCase() + item.slice(1)).join('');
    return uc.charAt(0).toLowerCase() + uc.slice(1);
}

/**
 * Возвращает значение вычисленного выражения.
 * @param context контекст.
 * @param expression выражение.
 * @param params параметры.
 * @return mixed
 */

export function evaluate (context, expression, params) {
    params = params || {};
    return new Function(...Object.keys(params), `try { ${expression} } catch (e) { console.warn(e); }`)
        .apply(context, Object.values(params));
}

/**
 * Возвращает нормализованное имя атрибута, заменяя различные сокращения на полные представления.
 * @param name имя атрибута.
 * @param value значение.
 * @return string
 */

export function normalizeAttribute (name, value) {
    if ([':class', ':style'].includes(name)) {
        return 'x-' + name.slice(1);
    } else if (name.charAt(0) === ':') {
        return 'x-prop' + name;
    } else if (name.charAt(0) === '@') {
        return 'x-on:' + name.slice(1);
    } else if (!name.includes('x-') && value.includes('${'))
        return 'x-attr:' + name;
    return name;
}
