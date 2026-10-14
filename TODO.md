- Azúcar: expresiones matemáticas arbitrarias en las entradas de los circuitos.
  - [x] Sumas (`+`), restas (`-`), multiplicaciones (`*`) y paréntesis, resueltas con el número
    mínimo de circuitos `copy` aprovechando el slot nativo `A * B + C`. Cables autogenerados con
    nombre diferenciable (`_MATH<n>`) que nunca solapa con los escritos a mano. Implementado en
    `src/maths.ts`; se ejecuta dentro de `expandToIni` (tras la expansión de blueprints). Tests
    exhaustivos (snapshots + fuzz con oráculo independiente) en `test/maths.test.ts`.
  - [x] Solo en `.droider`/`.blueprint`: el linter marca como error cualquier expresión más allá de
    `A * B + C` en ficheros `.ini`.
  - [x] Graph view: las expresiones con paréntesis se muestran como una unidad (una sola fila de
    fórmula con sus cables conectados), no como una serie de copys.
  - [ ] Resto de operaciones con circuitos `math`: división con `/`, módulo con `%`, potencia con `**`.
  - [ ] Llamadas estilo función con el nombre de la operación y su número de operandos, p.ej.
    `maximum(_Cable1, _Cable2)` o `root(2)`. Para operaciones N-arias (p.ej. `maximum(1, 2, 3, 4)`)
    mapear al número adecuado de circuitos.
