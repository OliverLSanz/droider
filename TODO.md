- [ ] Siguiente azúcar: expresiones matemáticas arbitrarias en las entradas de los circuitos. Las sumas,
  restas y multiplicaciones deben resolverse con el numero minimo de circuitos copy, asegurandose de que los cables
  autogenerados no solapan nombre y tienen nombres diferenciables de los no autogenerados. El resto de operaciones
  matematicas se resolveran con circuitos maths. La division debe hacerse con operadores /, modulo con %, power con **
  . Ademas de estos alias se aceptaran llamadas estilo funciones, con el nombre de cada operacion y el numero de 
  operandos que espera, por ejemplo maximum(_Cable1, _Cable2) o root(2). Para operaciones que teoricamente podrian 
  aceptar un numero N de parametros, como maximum, lo aceptamos: maximim(1, 2, 3, 4), y se mapea al numero adecuado de
  circuitos. Debe haber un cambio en el graph view para que las expresiones matematicas complejas puedan verse bien como una unidad, y no como una serie de copys