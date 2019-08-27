/**
 * Подписчик на изменения.
 */

export default class Subscriber {
	/**
	 * Конструктор.
	 * @param name имя.
	 */

	constructor (name) {
		this.name = name;
		this.observers = [];
	}

	/**
	 * Добавляет обозревателя.
	 * @param observer обозреватель.
	 */

	add (observer) {
		if (!this.observers.some(v => v.object === observer.object && v.update === observer.update))
			this.observers.push(observer);
	}

	/**
	 * Удаляет подписки элемента.
	 * @param object элемент.
	 */

	remove (object) {
		let index = -1;
		while ((index = this.observers.findIndex(v => v.object === object)) >= 0) {
			for (const observer of this.observers.splice(index, 1))
				observer.rollBack(object);
		}
	}

	/**
	 * Обновляет указанный элемент.
	 * Если элемент не указан, то обновляет все элементы.
	 * @param object элемент.
	 */

	update (object) {
		for (const observer of this.observers) {
			const target = object === undefined ? observer.object : object;
			if (observer.object === target)
				observer.update(target);
		}
	}
}
