# ADR 0001 · La caja es un libro de movimientos que solo se agrega

- Estado: aceptada
- Fecha: 2026-11-18

## Contexto

El Gallinero necesita llevar el efectivo del negocio: lo que entra por ventas y abonos cobrados en efectivo, lo que sale al pagar mercancía a las fincas y los gastos del día, y un cierre en el que el dueño cuenta el dinero y la app compara. Los datos viven en `localStorage` de un teléfono (ver el README) y se respaldan en JSON y en un Google Sheet. Guardar solo un «saldo actual» no permite saber de dónde salió una diferencia ni deshacer una venta sin dejar el dinero huérfano.

## Decisión

1. **Libro de movimientos append-only.** Cada entrada o salida de efectivo es un movimiento (`ingreso` o `egreso`, con monto siempre positivo). Nada se edita ni se borra: anular algo agrega un **contra-asiento** (`origen: 'anulacion'`) que apunta al original. El saldo es la suma de los movimientos, redondeada a centavos.
2. **`ref` + `refTipo`.** Cada movimiento guarda qué lo originó: `ref` es el id de una venta, una compra o un movimiento, y `refTipo` (`'venta'`, `'compra'`, `'mov'` o `null`) dice de cuál de esos tres. Así una venta y una compra con el mismo número no se confunden. Los datos anteriores sin `refTipo` se infieren del origen al cargar.
3. **Ids únicos y crecientes.** `nuevoId()` es un contador monótono; al cargar o restaurar, los ids repetidos de movimientos y cierres se renumeran (el primero conserva el suyo).
4. **Un cierre por día.** El cierre compara lo contado con el saldo calculado y, si hay diferencia, la anota como ajuste. Cerrar de nuevo el mismo día es posible pero pide confirmación; la vista de un día pasado muestra el cierre guardado de ese día.
5. **La caja solo cuenta desde que se activa**, con un saldo inicial. Lo vendido o comprado antes no tiene movimientos: anularlo no toca el efectivo y la app lo avisa.
6. **Un solo dispositivo.** El estado completo se guarda de una vez en ese teléfono; con dos teléfonos, **gana el último que guarda** y el otro pierde sus movimientos.
7. **`por` = «Dueño».** Cada movimiento guarda quién lo registró, pero hasta que exista el login de empleados siempre es «Dueño».

## Consecuencias

- Auditable: se puede reconstruir el saldo de cualquier día y ver cada anulación. El costo es que la lista crece (se ven los movimientos anulados, atenuados) y que anular exige lógica de «pendientes de revertir» en vez de borrar.
- Una devolución parcial de un proveedor crea contra-asientos por menos que el original; lo no devuelto queda como saldo a favor con el proveedor.
- El cierre no es un candado: hay un cierre por día por convención, no por restricción.
- **Si se necesita más de un dispositivo:** fusionar por id en lugar de reemplazar (los ids ya son únicos por diseño), guardar un campo `dispositivo` en cada movimiento y definir cómo se resuelven dos cierres del mismo día. Hoy no se hace.
- **Roles futuros (EVA-001):** cuando exista el login, el empleado solo **registra** (ventas, cobros, gastos); anular, cerrar y activar la caja quedan para el **dueño**. Hoy cualquiera con el teléfono puede hacerlo todo.
