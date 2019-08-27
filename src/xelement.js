/* Dmitry Kadochnikov (iqmass@gmail.com). MIT License. */

import * as Helpers from './helpers';
import {Subscriber} from './subscriber';
import {UniqueStack} from './uniqueStack';

// Символ проксированния.
const proxied = Symbol('proxied');

// Стек подписчиков на изменения свойсва.
const observersStack = new UniqueStack;

/**
 * Базовый элемент.
 */

export class XElement extends HTMLElement {
    /**
     * Возвращает отслеживаемые атрибуты.
     */

    static get observedAttributes () {
        return [];
    }

    /**
     * Конструктор.
     */

    constructor () {
        super();

        Object.defineProperties(this, {
            subscribers: { value: {} },
        });

        let parentXElement = null;
        Object.defineProperty(this, 'parentXElement', {
            get: () => {
                if (parentXElement === null) {
                    let parent = this;
                    while (parent = parent.parentElement) {
                        if (parent instanceof XElement || !parent.matches(':defined'))
                            return parentXElement = parent;
                    }
                    parentXElement = undefined;
                } else
                    return parentXElement;
            },
        });

        // TODO: Избавиться от этого, когда браузеры ввнедрят поддержку
        // TODO: CSS Shadow Parts или хотя бы Constructable Stylesheets.
        const styleSheets = [];
        Object.defineProperty(this, 'styleSheets', {
            get: () => styleSheets,
            set: sheets => {
                setTimeout(() => {
                    styleSheets.length = 0;
                    for (const sheet of [...sheets].reverse()) {
                        if (sheet instanceof CSSStyleSheet && sheet.ownerNode) {
                            this.shadowRoot.prepend(sheet.ownerNode.cloneNode(true));
                            styleSheets.push(sheet);
                        } else
                            throw new TypeError('Invalid style sheet');
                    }
                });
            },
        });

        if (this.template) {
            this.attachShadow({ mode: 'open' })
                .innerHTML = this.template;
        }
    }

    /**
     * Возвращает шаблон элемента.
     * @return string
     */

    get template () {
        return `<slot></slot>`;
    }

    /**
     * Возвращает свойства элемента.
     * @return object
     */

    get properties () {
        return {};
    }

    /**
     * Элемент смонтирован.
     */

    connectedCallback () {
        const properties = this.properties;
        for (const name in properties) {
            this.define(name,
                this.hasOwnProperty(name) ? this[name] : properties[name],
                Helpers.getType(properties[name])
            );
        }

        for (const name of this.getAttributeNames()) {
            const property = Helpers.textToProperty(name);
            if (this.hasOwnProperty(property))
                this[property] = this.getAttribute(name);
        }

        for (const children of [...this.shadowRoot.childNodes])
            this.setup(children);

        const parentXElement = this.parentXElement;
        if (parentXElement) {
            customElements.whenDefined(parentXElement.localName)
                .then(() => parentXElement.forceUpdate(this));
        }
    }

    /**
     * Элемент демонтирован.
     */

    disconnectedCallback () {
        for (const children of [...this.shadowRoot.childNodes])
            this.tearDown(children);

        for (const name in this.properties)
            delete this[name];

        for (const name in this.subscribers)
            delete this.subscribers[name];
    }

    /**
     * Элемент изменил владельца.
     */

    adoptedCallback () {
    }

    /**
     * Отслеживаемый атрибут изменился.
     * @param name имя атрибута.
     * @param oldValue старое значение.
     * @param newValue новое значение.
     */

    attributeChangedCallback (name, oldValue, newValue) {
    }

    /**
     * Создает свойство элемента.
     * @param name имя свойства.
     * @param value значение.
     * @param type тип.
     */

    define (name, value, type) {
        let timeout = 0;
        const subscriber = new Subscriber(name);
        XElement.defineProperty(this, name, {
            value: value,
            type: type || Helpers.getType(value),
            getting: () => {
                if (!observersStack.empty)
                    subscriber.add(observersStack.current);
            },
            setting: () => {
                clearTimeout(timeout);
                timeout = setTimeout(() => subscriber.update());
            },
        });
        this.subscribers[name] = subscriber;
    }

    /**
     * Выполняет первоначальную настройку узла и возвращает его.
     * @param node узел.
     * @param context контекст.
     */

    setup (node, context) {
        context = Object.assign(context || {}, {
            $parent: this.parentXElement,
            $node: node,
        });

        if (node instanceof HTMLElement) {
            for (const name of node.getAttributeNames()) {
                const value = node.getAttribute(name);
                const attribute = Helpers.normalizeAttribute(name, value);
                if (attribute !== name) {
                    node.removeAttribute(name);
                    node.setAttribute(attribute, value);
                }

                if (attribute.includes('x-')) {
                    const method = Helpers.textToProperty(attribute.split(':').shift().replace('x-', 'bind-'));
                    if (typeof this[method] === 'function') {
                        if (this[method](node, attribute, context) === false)
                            return false;
                    } else
                        throw new Error(`Invalid binder: ${attribute}`);
                }
            }

            if (node instanceof XElement || !node.matches(':defined'))
                return false;
        } else if (node instanceof Text && node.textContent.includes('${'))
            this.bindTextContent(node, context);

        const nodes = node instanceof HTMLSlotElement ? node.assignedNodes() : node.childNodes;
        for (const children of [...nodes])
            this.setup(children, context);
    }

    /**
     * Удаляет выполненные ранее настройки узла.
     * @param node узел.
     */

    tearDown (node) {
        for (const name in this.subscribers)
            this.subscribers[name].remove(node);

        const nodes = node instanceof HTMLSlotElement ? node.assignedNodes() : node.childNodes;
        for (const children of [...nodes])
            this.tearDown(children);
    }

    /**
     * Принудительно обновляет указанный узел.
     * Если узел не указан, то обновляет все зависимые узлы.
     * @param node узел.
     */

    forceUpdate (node) {
        for (const name in this.subscribers)
            this.subscribers[name].update(node);
    }

    /**
     * Инициирует событие указанного типа.
     * @param type тип события.
     * @param detail детали.
     * @return bool
     */

    dispatchCustomEvent (type, detail) {
        return this.dispatchEvent(
            new CustomEvent(type, {
                cancelable: true,
                detail: detail,
            })
        );
    }

    /**
     * Назначает узел слотом - точкой вставки шаблона.
     * @param node узел.
     * @param attribute имя атрибута.
     * @param context контекст.
     */

    bindSlot (node, attribute, context) {
        const expression = node.getAttribute(attribute) || 'default';
        const template = this.querySelector(expression === 'default'
            ? `:scope > template[slot="${expression}"], :scope > template:not([slot])`
            : `:scope > template[slot="${expression}"]`
        );
        if (template) {
            const clones = [];
            const trigger = Object.keys(this.properties).shift();
            const comment = document.createComment(`${attribute}: ${expression}`);
            XElement.observe(comment, {
                update: comment => this[trigger],
                commit: comment => {
                    node.removeAttribute(attribute);
                    node.before(comment);
                    node.remove();
                    for (const clone of [...template.content.cloneNode(true).children]) {
                        const bindings = {};
                        for (const name of clone.getAttributeNames()) {
                            const bind = Helpers.normalizeAttribute(name, clone.getAttribute(name));
                            if (bind !== name) {
                                bindings[bind] = clone.getAttribute(name);
                                clone.removeAttribute(name);
                            }
                        }
                        for (const name of node.getAttributeNames()) {
                            const value = node.getAttribute(name);
                            const bind = Helpers.normalizeAttribute(name, value);
                            clone.setAttribute(bind, [value, clone.getAttribute(bind)].join(' ').trim());
                        }
                        for (const name in bindings)
                            clone.setAttribute(name, bindings[name]);
                        clones.push(clone);
                        comment.before(clone);
                        this.setup(clone, context);
                    }
                },
                rollBack: comment => {
                    for (const clone of clones) {
                        this.tearDown(clone);
                        clone.remove();
                    }
                    node.setAttribute(attribute, '');
                    comment.before(node);
                    comment.remove();
                },
            });
        }
        return false;
    }

    /**
     * Подключает узел к DOM, если результат вычисления выражения истинный.
     * @param node узел.
     * @param attribute имя атрибута.
     * @param context контекст.
     */

    bindIf (node, attribute, context) {
        let elseNode;
        const elstAttribute = 'x-else';
        if (node.nextElementSibling && node.nextElementSibling.hasAttribute(elstAttribute))
            elseNode = node.nextElementSibling;

        const expression = node.getAttribute(attribute);
        const comment = document.createComment(`${attribute}: ${expression}`);
        XElement.observe(comment, {
            update: comment => {
                if (Boolean(Helpers.evaluate(this, `return ${expression}`, context))) {
                    this.setup(node, context);
                    if (!node.parentNode)
                        comment.before(node);
                    if (elseNode) {
                        this.tearDown(elseNode);
                        if (elseNode.parentNode)
                            elseNode.remove();
                    }
                } else {
                    this.tearDown(node);
                    if (node.parentNode)
                        node.remove();
                    if (elseNode) {
                        this.setup(elseNode, context);
                        if (!elseNode.parentNode)
                            comment.before(elseNode);
                    }
                }
            },
            commit: comment => {
                node.removeAttribute(attribute);
                node.before(comment);
                if (elseNode)
                    elseNode.removeAttribute(elstAttribute);
            },
            rollBack: comment => {
                node.setAttribute(attribute, expression);
                comment.before(node);
                if (elseNode) {
                    elseNode.setAttribute(elstAttribute, '');
                    comment.before(elseNode);
                }
                comment.remove();
            },
        });
        return false;
    }

    /**
     * Клонирует узел на основе выражения в атрибуте.
     * @param node узел.
     * @param attribute имя атрибута.
     * @param context контекст.
     */

    bindFor (node, attribute, context) {
        const clones = [];
        const expression = node.getAttribute(attribute);
        const comment = document.createComment(`${attribute}: ${expression}`);
        const [match, list, index, item] = expression.match(/([\w.]+)(?:\s+as\s+(?:(\w+):\s+)?(\w+))?/);
        XElement.observe(comment, {
            update: comment => {
                const items = Helpers.evaluate(this, `return ${list}`, context);
                if (Array.isArray(items) || Helpers.isPlainObject(items)) {
                    for (const clone of clones.splice(0, clones.length)) {
                        this.tearDown(clone);
                        clone.remove();
                    }
                    for (const i in items) {
                        const context = { [index || 'index']: i, [item || 'item']: items[i] };
                        const clone = node.cloneNode(true);
                        clone.removeAttribute(attribute);
                        this.setup(clone, context);
                        comment.before(clone);
                        clones.push(clone);
                    }
                    setTimeout(() => this.forceUpdate(comment.parentNode));
                } else
                    throw new TypeError(`Invalid iterator: ${list}`);
            },
            commit: comment => {
                node.before(comment);
                node.remove();
            },
            rollBack: comment => {
                for (const clone of clones.splice(0, clones.length)) {
                    this.tearDown(clone);
                    clone.remove();
                }
                comment.before(node);
                comment.remove();
            },
        });
        return false;
    }

    /**
     * Устанавливает значение свойства узла на основе выражения в атрибуте.
     * @param node узел.
     * @param attribute имя атрибута.
     * @param context контекст.
     */

    bindProp (node, attribute, context) {
        const expression = node.getAttribute(attribute) || attribute.split(':').pop();
        const name = Helpers.textToProperty(attribute.split(':').pop());
        XElement.observe(node, {
            update: node => node[name] = Helpers.evaluate(this, `return ${expression}`, context),
            commit: node => node.removeAttribute(attribute),
            rollBack: node => node.setAttribute(attribute, expression),
        });
    }

    /**
     * Устанавливает обработчик события узла на основе выражения в атрибуте.
     * @param node узел.
     * @param attribute имя атрибута.
     * @param context контекст.
     */

    bindOn (node, attribute, context) {
        const expression = node.getAttribute(attribute);
        const type = Helpers.textToProperty(attribute.split(':').pop());
        const trigger = Object.keys(this.properties).shift();
        const handler = e => Helpers.evaluate(this, `return ${expression}`, Object.assign({ $e: e }, context));
        XElement.observe(node, {
            update: node => this[trigger],
            commit: node => {
                node.removeAttribute(attribute);
                node.addEventListener(type, handler);
            },
            rollBack: node => {
                node.removeEventListener(type, handler);
                node.setAttribute(attribute, expression);
            },
        });
    }

    /**
     * Устанавливает значение поля ввода на основе выражения в атрибуте.
     * @param node узел.
     * @param attribute имя атрибута.
     * @param context контекст.
     */

    bindModel (node, attribute, context) {
        if (node instanceof HTMLInputElement || node instanceof HTMLSelectElement || node instanceof HTMLTextAreaElement) {
            const expression = node.getAttribute(attribute);
            const options = {
                type: 'input',
                get: () => Helpers.evaluate(this, `return ${expression}`, context),
                set: value => Helpers.evaluate(this, `${expression} = $value`, Object.assign({ $value: value }, context)),
                updateNode: (node, value) => {
                    value = Helpers.isPlainObject(value) ? value[node.name] : value;
                    node.value = (value !== undefined && value !== null) ? value : '';
                },
                updateProperty: e => {
                    const value = options.get();
                    if (Helpers.isPlainObject(value)) {
                        value[node.name] = node.value;
                    } else
                        options.set(node.value);
                },
            }

            switch (node.type) {
                case 'radio':
                    options.type = 'change';
                    options.updateNode = (node, value) => node.checked = node.value == value;
                    break;
                case 'checkbox':
                    options.type = 'change';
                    options.updateProperty = e => {
                        const value = options.get();
                        const nodeValue = node.checked ? node.value : '';
                        if (Array.isArray(value)) {
                            if (!node.checked) {
                                let index = -1;
                                while ((index = value.findIndex(v => v == node.value)) >= 0)
                                    value.splice(index, 1);
                            } else
                                value.push(node.value);
                        } else if (Helpers.isPlainObject(value)) {
                            value[node.name] = nodeValue;
                        } else
                            options.set(nodeValue);
                    };
                    options.updateNode = (node, value) => {
                        if (Array.isArray(value)) {
                            node.checked = value.some(v => v == node.value);
                        } else if (Helpers.isPlainObject(value)) {
                            node.checked = Boolean(value[node.name]);
                        } else
                            node.checked = Boolean(value);
                    };
                    break;
                case 'select-one':
                    options.type = 'change';
                    options.updateNode = (node, value) => {
                        value = Helpers.isPlainObject(value) ? value[node.name] : value;
                        if (value === undefined || value === null || value === '') {
                            node.selectedIndex = 0;
                        } else
                            node.value = value;
                    };
                    break;
                case 'select-multiple':
                    options.type = 'change';
                    options.updateProperty = e => {
                        const value = options.get();
                        value.length = 0;
                        for (const option of node.options) {
                            if (option.selected)
                                value.push(option.value);
                        }
                    };
                    options.updateNode = (node, value) => {
                        for (const option of node.options)
                            option.selected = value.some(v => v == option.value);
                    };
                    break;
            }

            XElement.observe(node, {
                update: node => options.updateNode(node, options.get()),
                commit: node => {
                    node.removeAttribute(attribute);
                    node.addEventListener(options.type, options.updateProperty);
                },
                rollBack: node => {
                    node.removeEventListener(options.type, options.updateProperty);
                    node.setAttribute(attribute, expression);
                },
            });
        } else
            throw new TypeError('Unsupported node');
    }

    /**
     * Устанавливает значение атрибута узла на основе выражения в атрибуте.
     * @param node узел.
     * @param attribute имя атрибута.
     * @param context контекст.
     */

    bindAttr (node, attribute, context) {
        const name = attribute.split(':').pop();
        const expression = node.getAttribute(attribute);
        XElement.observe(node, {
            update: node => node.setAttribute(name, Helpers.evaluate(this, `return \`${expression}\``, context)),
            commit: node => node.removeAttribute(attribute),
            rollBack: node => {
                if (expression !== null) {
                    node.setAttribute(name, expression);
                } else
                    node.removeAttribute(name);
            },
        });
    }

    /**
     * Устанавливает классы узла на основе выражения в атрибуте.
     * @param node узел.
     * @param attribute имя атрибута.
     * @param context контекст.
     */

    bindClass (node, attribute, context) {
        const expression = node.getAttribute(attribute);
        const originalValue = node.hasAttribute('class') ? node.getAttribute('class') : undefined;
        XElement.observe(node, {
            update: node => {
                node.setAttribute('class', originalValue);
                const value = Helpers.evaluate(this, `return ${expression}`, context);
                if (value) {
                    if (Helpers.isPlainObject(value)) {
                        for (const i in value)
                            node.classList[value[i] ? 'add' : 'remove'](i);
                    } else if (Array.isArray(value)) {
                        node.classList.add(...value);
                    } else
                        node.classList.add(value);
                }
            },
            commit: node => node.removeAttribute(attribute),
            rollBack: node => {
                node.setAttribute(attribute, expression);
                if (originalValue !== undefined) {
                    node.setAttribute('class', originalValue);
                } else
                    node.removeAttribute('class');
            },
        });
    }

    /**
     * Устанавливает стили узла на основе выражения в атрибуте.
     * @param node узел.
     * @param attribute имя атрибута.
     * @param context контекст.
     */

    bindStyle (node, attribute, context) {
        const expression = node.getAttribute(attribute);
        const originalValue = node.hasAttribute('style') ? node.getAttribute('style') : undefined;
        XElement.observe(node, {
            update: node => {
                const value = Helpers.evaluate(this, `return ${expression}`, context);
                if (Helpers.isPlainObject(value)) {
                    for (const i in value)
                        node.style[i] = value[i];
                } else
                    throw new TypeError('Invalid style object');
            },
            commit: node => node.removeAttribute(attribute),
            rollBack: node => {
                node.setAttribute(attribute, expression);
                if (originalValue !== undefined) {
                    node.setAttribute('style', originalValue);
                } else
                    node.removeAttribute('style');
            },
        });
    }

    /**
     * Устанавливает текстовое содержимое узла на основе выражения в атрибуте.
     * @param node узел.
     * @param attribute имя атрибута.
     * @param context контекст.
     */

    bindText (node, attribute, context) {
        const expression = node.getAttribute(attribute);
        XElement.observe(node, {
            update: node => node.textContent = Helpers.evaluate(this, `return ${expression}`, context),
            rollBack: node => node.setAttribute(attribute, expression),
            commit: node => node.removeAttribute(attribute),
        });
    }

    /**
     * Устанавливает текстовое содержимое узла на основе выражения в содержимом узла.
     * @param node узел.
     * @param context контекст.
     */

    bindTextContent (node, context) {
        const textContent = node.textContent;
        XElement.observe(node, {
            update: node => node.textContent = Helpers.evaluate(this, `return \`${textContent}\``, context),
            rollBack: node => node.textContent = textContent,
        });
    }

    /**
     * Устанавливает HTML содержимое узла на основе выражения в атрибуте.
     * @param node узел.
     * @param attribute имя атрибута.
     * @param context контекст.
     */

    bindHtml (node, attribute, context) {
        const expression = node.getAttribute(attribute);
        XElement.observe(node, {
            update: node => node.innerHTML = Helpers.evaluate(this, `return ${expression}`, context),
            rollBack: node => node.setAttribute(attribute, expression),
            commit: node => node.removeAttribute(attribute),
        });
    }

    /**
     * Устанавливает видимость узла на основе выражения в атрибуте.
     * @param node узел.
     * @param attribute имя атрибута.
     * @param context контекст.
     */

    bindShow (node, attribute, context) {
        const wasHidden = node.hasAttribute('hidden');
        const expression = node.getAttribute(attribute);
        XElement.observe(node, {
            update: node => node.hidden = Helpers.evaluate(this, `return !Boolean(${expression})`, context),
            commit: node => node.removeAttribute(attribute),
            rollBack: node => {
                node.setAttribute(attribute, expression);
                if (wasHidden) {
                    node.setAttribute('hidden', 'hidden');
                } else
                    node.removeAttribute('hidden');
            },
        });
    }

    /**
     * Создает свойство объекта.
     * @param object объект.
     * @param name имя свойства.
     * @param options параметры.
     */

    static defineProperty (object, name, options) {
        options = Object.assign({
            type: undefined,
            value: undefined,
            enumerable: true,
            configurable: true,
            getting: () => false,
            setting: () => false,
        }, options);

        const proxy = target => {
            if ((Array.isArray(target) || Helpers.isPlainObject(target)) && !target[proxied]) {
                return new Proxy(target, {
                    get: (target, property) => {
                        return property !== proxied
                            ? target[property] : true;
                    },
                    set: (target, property, value) => {
                        target[property] = value;
                        options.setting();
                        return true;
                    },
                });
            } else
                return target;
        };

        const parseJSON = string => {
            if (typeof string === 'string' && string.length > 0)
                try { string = JSON.parse(string); } catch (e) {}
            return string;
        }

        let value = proxy(options.value);
        Object.defineProperty(object, name, {
            enumerable: options.enumerable,
            configurable: options.configurable,
            get: () => {
                options.getting();
                return value;
            },
            set: newValue => {
                switch (options.type) {
                    case Date:
                        value.setTime(newValue.getTime());
                        break;
                    case Boolean:
                        if (typeof newValue === 'string') {
                            if (['on', '1'].indexOf(newValue) >= 0) {
                                newValue = true;
                            } else if (['off', '0'].indexOf(newValue) >= 0)
                                newValue = false;
                        }
                        value = options.type(newValue);
                        break;
                    case Array:
                        newValue = parseJSON(newValue);
                        if (Array.isArray(newValue)) {
                            if (!newValue[proxied]) {
                                value.splice(0, value.length, ...newValue);
                            } else
                                value = newValue;
                        } else if (!Boolean(newValue)) {
                            value.length = 0;
                        } else
                            throw new TypeError(`Invalid value: ${name} => ${JSON.stringify(newValue)}`);
                        break;
                    case Object:
                        newValue = parseJSON(newValue);
                        if (Helpers.isPlainObject(newValue)) {
                            if (!newValue[proxied]) {
                                for (const name in value)
                                    delete value[name];
                                Object.assign(value, newValue);
                            } else
                                value = newValue;
                        } else if (!Boolean(newValue)) {
                            for (const name in value)
                                delete value[name];
                        } else
                            throw new TypeError(`Invalid value: ${name} => ${JSON.stringify(newValue)}`);
                        break;
                    default:
                        value = typeof options.type === 'function'
                            ? options.type(newValue) : newValue;
                        break;
                }
                options.setting();
            },
        });
    }

    /**
     * Связывает объект с обозревателем.
     * @param object объект.
     * @param observer обозреватель.
     */

    static observe (object, observer) {
        observer = Object.assign({
            object: object,
            commit: () => false,
            rollBack: () => false,
            update: () => false,
        }, observer);

        try {
            observersStack.push(observer);
            observer.commit(object);
            observer.update(object);
        } finally {
            observersStack.pop();
        }
    }
}
