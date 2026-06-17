- [ ] BUG: The math module autocompletion finds input, but not input1 or input2. Though they are correctly validated by the linter.
- [ ] VISUAL IMPROVEMENT: Add the same capsule to the back of labels in every control: small and big pots, buttons, etc.
- [ ] BUG: The labels with capsule appear on top of tooltips, hiding them. Tooltips should be on top of everything.
- [ ] BUG: Certain elements like number labels of buttons to the right of the button triggerting the tooltip show on top of the tooltip.
- [ ] BUG: Tooltips at the left elements of the master droid appear partly outside of the window and thus cannot be read.
- [ ] IMPROVEMENT: I want open panes (hardware and grapth view) to load on a vindow reload: now it only shows a empty pane.
- [x] Infraestructura de azúcar sintáctico: 3 tipos de fichero — `.ini` (sin azúcar, rechaza el azúcar
  como errores), `.droider` (acepta azúcar), `.blueprint` (define megacircuitos). Linter, autocompletado,
  hover, semantic y rainbow-cables son conscientes del modo. Al pulsar "subir a droid" desde un `.droider`
  se genera `dist/<nombre>.ini` (raíz del workspace) con el azúcar expandido, y ese `.ini` es lo que se
  sube a la tarjeta. Comando extra `DROID: Build .droider to dist/*.ini`. CLI infiere el modo por extensión.

- [x] Primer azúcar — megacircuitos (`.blueprint`): nombre = nombre de fichero. Secciones `[input]`/`[output]`
  declaran puertos por nombre (uno por línea); en el cuerpo se referencian directamente por ese nombre. En
  inputs, `nombre = valor` da un valor por defecto (lo hace opcional); los inputs sin default son obligatorios.
  El comentario sobre cada puerto es su documentación en el autocompletado; el bloque de comentarios al inicio
  del fichero documenta el megacircuito. Los cables `_` del cuerpo son privados (ocultos desde fuera). Se usan
  en `.droider` como `[nombre]` con un parámetro por puerto. Al expandir, las referencias a puertos se
  sustituyen por lo que cablea el llamante (o su default) y los cables privados se renombran a
  `__<nombre>_<n>_<CABLE>` (únicos por instancia). Anidamiento recursivo (con detección de ciclos). Las
  expresiones compuestas en un input se materializan en un `copy` extra para no romper la precedencia.
  Ejemplos en `test-patches/mix2.blueprint`, `nested.blueprint`, `demo.droider`.

- [ ] Siguiente azúcar: expresiones matemáticas arbitrarias en las entradas de los circuitos. Las sumas,
  restas y multiplicaciones deben resolverse con el numero minimo de circuitos copy, asegurandose de que los cables
  autogenerados no solapan nombre y tienen nombres diferenciables de los no autogenerados. El resto de operaciones
  matematicas se resolveran con circuitos maths. La division debe hacerse con operadores /, modulo con %, power con **
  . Ademas de estos alias se aceptaran llamadas estilo funciones, con el nombre de cada operacion y el numero de 
  operandos que espera, por ejemplo maximum(_Cable1, _Cable2) o root(2). Para operaciones que teoricamente podrian 
  aceptar un numero N de parametros, como maximum, lo aceptamos: maximim(1, 2, 3, 4), y se mapea al numero adecuado de
  circuitos.