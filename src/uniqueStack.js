/**
 * Стек уникальных значений.
 */

export default class UniqueStack {
    /**
     * Конструктор.
     */

    constructor () {
        this.values = [];
    }

    /**
     * Стек пуст?
     */

    get empty () {
        return this.values.length === 0;
    }

    /**
     * Возвращает текущее значение.
     */

    get current () {
        return this.values[
            this.values.length - 1
        ];
    }

    /**
     * Добавляет значение, если его еще нет в стеке.
     * @param value значение.
     */

    push (value) {
        if (!this.values.some(v => v === value))
            this.values.push(value);
    }

    /**
     * Удалет текущее значение.
     */

    pop () {
        this.values.pop();
    }
}
