# Folup: diagnóstico de calidad y plan incremental

11 de septiembre de 2026 · Base revisada: ae631cb. Análisis, sin cambios de aplicación ni producción.

## Conclusión

No conviene empezar cambiando de modelo. El código posterior a la IA puede modificar el significado, perder acciones y completar datos no mencionados. La etiqueta alta/media/baja actual no representa una probabilidad de acierto. Primero hay que preservar lo extraído, distinguir hechos de sugerencias y medir cada cambio.

Objetivo de producto: hablar naturalmente tras una visita → nota fiel lista para CRM + todas las acciones del representante → aclarar solo dudas relevantes → el usuario elige qué exportar al calendario. Una visita sin compromiso futuro debe poder producir cero acciones.

## Alcance y límites

- Revisados transcripción, prompt activo, parser/mapper, fases de ranking/normalización, confianza, aclaraciones, correcciones, texto CRM, exportación, persistencia, controles de consumo y rutas Stripe.
- Ejecutadas nueve sondas deterministas sobre funciones reales (abajo). No son nueve grabaciones ni una estimación de tasa de error en usuarios.
- Ejecutado el harness existente: cinco casos pasan. Usa JSON preparado, no consulta al modelo ni comprueba audio.
- No se hicieron llamadas de pago. No se midieron precisión real de transcripción, p95 de latencia, costos observados, ruido móvil ni estados reales de Stripe. Tampoco es una auditoría exhaustiva de seguridad externa.
- Las 15 pruebas y la compilación del bloque anterior no demuestran calidad semántica del modelo.

## Cómo funciona hoy

1. MediaRecorder recoge audio y lo envía al servidor.
2. `whisper-1` transcribe con contexto fijo agrícola y nombres concretos de productos.
3. Un detector local decide inglés/español; basta un carácter acentuado para imponer español.
4. `gpt-4.1`, temperatura 0, recibe un prompt que obliga a producir primary/supporting, resumen e insights. No se solicita JSON Schema estricto.
5. El parser recorta objetos y descarta tipos no reconocidos; el mapper hereda empresa/contacto y calcula confianza.
6. Un pipeline vuelve a extraer/priorizar, filtra, deduplica y resuelve fechas. La ruta vuelve a modificar capitalización e insights.
7. El frontend normaliza otra vez, infiere contacto, completa fechas y decide las ventanas. Correcciones siguen un recorrido distinto.
8. El texto CRM y los eventos se generan desde estas representaciones; las notas se guardan por el servidor autenticado.

## Confianza: qué significa realmente

En `lib/structuredAiMapper.ts:422` se crean algunas banderas por campos ausentes. En la línea 490: ninguna → alta; una → media; dos o más → baja. No mide errores de pronunciación, certeza del nombre, contradicciones ni asociación persona-empresa. Tampoco incluye ausencia de empresa ni destinatario vacío para send.

Las ventanas en `app/page.tsx:1063` dependen de confianza baja. Hay una protección adicional en creación por voz y texto (`:2764`, `:2835`) que fuerza baja si falta el contacto o el título está incompleto. Por eso no sería correcto afirmar que todo contacto ausente pasa sin pregunta. Correcciones no recorren esas mismas ventanas (`:2562`).

Propuesta: estado por campo y por acción: identificado, ambiguo, no mencionado, no aplica; más origen: dicho por el usuario, aclarado por el usuario, sugerido. Guardar la frase de respaldo para los datos críticos. Una puntuación del modelo sería solo una señal a evaluar, nunca garantía ni porcentaje de precisión.

Política de preguntas:

- Nombre/empresa dudosos: pregunta puntual mostrando la frase; no inventar alternativas sin fundamento.
- Fecha no mencionada: conservar sin fecha; pedirla al exportar si hace falta.
- Fecha contradictoria o ambigua: pedir aclaración, sin decidir silenciosamente.
- Empresa no mencionada: permitir completar u omitir; no bloquear una nota útil automáticamente.
- Varias personas: preguntar únicamente si no se sabe a cuál corresponde una acción.
- Duda en una acción: no bloquear ni modificar las demás.
- Un nombre mal transcrito pero plausible puede pasar inadvertido. El sistema no puede garantizar detectarlo; mantener edición fácil y, con política de retención definida, permitir revisar el audio.

## Problemas por impacto

### P0 · El código cambia la intención

Evidencia: `lib/structuredAiMapper.ts:225` busca palabras en toda la nota y cambia primary.type. Reproducción: una llamada correcta y texto «Do not send the quote. Call Ana Friday.» se convierten en send. No analiza negación ni quién actúa.

Solución: no reescribir tipos por palabras globales; cada acción debe conservar su evidencia local, persona y estado futuro/pasado/negado. Validación puede marcar dudas, no inventar reemplazos. Esfuerzo: 1–2 días junto con regresiones. Riesgo: retirar reglas que hoy compensan fallos del prompt; comparar antes/después.

### P0 · Acciones incompletas y empresas equivocadas

Evidencia: `lib/structuredAiMapper.ts:109` no admite meeting como supporting; `:135` exige primary no nulo; `:452` asigna a todas las acciones la empresa primaria. El esquema no representa empresa por acción secundaria. Objetos se recortan a 8/10 palabras (`:150`, `:184`), aunque el prompt prohíbe cortar frases.

Solución: lista única de acciones, incluyendo cero acciones, con identificadores propios y referencias a personas/organizaciones; priorizar solo para mostrar, nunca para eliminar. Guardar texto completo y acortar únicamente su presentación. Esfuerzo: 2–3 días. Riesgo: cambios simultáneos de contrato, UI y guardado; versionar estructura y añadir adaptador temporal.

### P0 · Se confunde ausencia con certeza y se completan datos

Evidencia: regla de confianza descrita arriba; `app/page.tsx:1225` alinea destinatario con contacto y pone el siguiente día laborable a call/meeting/send sin fecha cuando la confianza no es baja. Aclaraciones actúan sobre campos principales, no cada acción.

Solución: estados por campo, validación única para voz/texto/corrección; no completar fecha o destinatario como si fueran hechos. Reutilizar ventanas actuales. Esfuerzo: 1–2 días tras el contrato. Riesgo: demasiadas interrupciones; medir preguntas innecesarias y permitir omitir datos no críticos.

### P1 · El prompt obliga a crear seguimientos y tiene contradicciones

Evidencia: `lib/structuredAiPrompt.ts` exige primary; interés general implica follow_up; sin fecha asigna this_week/next_week; R2 inventa llamada/seguimiento 5–7 días antes de un pedido del cliente. A la vez R4 exige fecha propia explícita y R5 prohíbe omitir tareas. «ANY send verb» compite con exclusión de entregas pasadas. «Todas las cadenas en el idioma de la nota» no exceptúa enums ni marcas.

Solución: separar hechos, compromisos y sugerencias opcionales; permitir actions=[]; autocorrección explícita prevalece; respetar negaciones, tareas de terceros, marcas y nombres propios. Quitar ejemplos sectoriales dominantes salvo contexto elegido por usuario. Esfuerzo: 1–2 días incluyendo evaluación, no solo edición del texto. Riesgo: extraer menos implícitos legítimos; medir por separado solicitudes indirectas y recomendaciones no acordadas.

### P1 · JSON válido no equivale a datos correctos

Evidencia: `app/api/structure/route.ts:280` pide chat completions sin response_format; después extrae JSON de texto y valida permisivamente. Existe un contrato alternativo en `lib/voiceNoteExtraction.ts`, pero no es el contrato activo del modelo.

Solución: un contrato tipado y JSON Schema estricto; manejar rechazo, truncamiento y errores de proveedor; validación semántica de fechas, referencias y evidencia. Mantener inicialmente el modelo para aislar mejoras. Esfuerzo: 0,5–1 día con el cambio de contrato. Riesgo: formato estricto no evita invenciones semánticas.

### P1 · Idioma y transcripción necesitan evaluación real

Evidencia: `lib/detectNoteLanguage.ts:52` clasifica español si hay acentos. Reproducción: «I met José at Acme. I will call him Friday.» → Spanish. `app/api/transcribe/route.ts:9` usa vocabulario agrícola fijo, mientras extracción privilegia ejemplos médicos.

Solución: respetar idioma dominante/configurado y permitir mezcla; nombres propios no determinan idioma. Glosario opcional con productos/contactos reales, sin corrección automática de identidades por similitud. Comparar transcriptores sobre audio real con ruido y pronunciaciones variadas. Esfuerzo: 0,5–1 día de lógica + evaluación de audio. Riesgo: sesgo del glosario; una alternativa de modelo no está demostrada como mejor para Folup.

### P1 · Correcciones no tienen las mismas garantías

Evidencia: `app/page.tsx:2562` concatena ORIGINAL NOTE y CORRECTION, reprocesa con el instante actual y no pasa por el mismo flujo de aclaración. `:2580` llama updateNote sin await (la función tiene su propio manejo de error).

Solución: corrección como operación explícita sobre la nota, conservar fecha de la visita para relativos originales y distinguir nuevos compromisos; actualizar solo lo corregido, revalidar y reflejar guardado pendiente/error. Esfuerzo: 1–2 días. Riesgo: correcciones que añaden acciones frente a las que sustituyen; casos separados obligatorios.

### P1 · Las pruebas actuales pueden premiar información añadida

Evidencia: `lib/structuredAiTestHarness.ts:174` contiene cinco JSON manuales. Primer caso: el JSON incluye vecino/expansión no dichos en la nota (`:212`). Comprueba categorías por palabras clave, no correspondencia de hechos, personas, fechas ni integridad de acciones.

Solución: corpus con verdad esperada y hechos prohibidos, pruebas por capa y audio→resultado. No usar las salidas actuales como verdad. Esfuerzo inicial: 1 día; ampliación continua. Riesgo: sobreajustar al corpus; separar desarrollo y conjunto reservado.

### P2 · CRM y calendario no comparten un contrato fiable

Evidencia: `lib/formatCrmSalesNote.ts:70` excluye compromisos y fechas, limita cabecera a un contacto y mantiene etiquetas inglesas. El prompt también excluye acuerdos del resumen. Esto requiere alinear el copy con el objetivo de registrar qué se acordó, sin duplicar tareas de forma confusa. `app/page.tsx:2941` marca añadido antes de que el usuario guarde en Google; iniciar sesión selecciona Google automáticamente.

Solución: copy basado en hechos confirmados: participantes, sitio, temas, acuerdos; acciones operables separadas en pantalla. Elegir calendario, distinguir «abierto para revisar» de «guardado confirmado». Esfuerzo: 1–2 días. Riesgo: afirmar confirmación sin integración capaz de verificarla; no añadir OAuth Calendar complejo si basta exportación honesta.

### P2 · Confiabilidad, velocidad y monetización

Evidencia: endpoints OpenAI sin timeout/retry explícitos; recorrido voz tiene espera adicional de 550 ms (`app/page.tsx:2792`). Hay logs de acciones durante ranking. El webhook Stripe solo trata checkout completado y suscripción eliminada, sin verificar errores de persistencia (`app/api/stripe/webhook/route.ts:26`). No hay métricas suficientes de calidad o costo observado.

Solución: métricas sin notas crudas, tiempos por etapa, timeouts acotados, reintentos seguros y conservación de transcripción ante fallo; sincronización idempotente del estado de suscripción y recuperación de errores. Revisar cuotas por intento frente a nota completada y límite global de gasto. Esfuerzo: 2–3 días. Riesgo: reintentos duplicados o acceso de pago incorrecto. No fue probado con eventos Stripe reales en esta revisión.

## Reproducciones deterministas ejecutadas

1. Falta fecha → confidence=medium y unclear_date.
2. Falta empresa → confidence=high, sin flags.
3. Envío sin destinatario → confidence=high en mapper; creación UI tiene protección adicional, corrección no equivalente.
4. Reunión secundaria → desaparece en parser.
5. Bob de Beta como acción secundaria de Ana/Acme → Bob queda asociado a Acme.
6. «Do not send… Call Ana Friday.» con primary call → mapper lo cambia a send.
7. primary=null → parser rechaza la respuesta.
8. Nota inglesa con José → idioma Spanish.
9. Objeto largo «the complete clinical trial results from the intensive care unit in Baja California» → «the complete clinical trial results from the intensive».

Estas sondas aíslan funciones; no prueban que el modelo produzca esos JSON ni que toda la UI muestre exactamente el resultado intermedio.

## Orden de implementación y puertas de aceptación

0. Fijar corpus y reproducir fallos actuales. Sin cambiar comportamiento.
1. Quitar reescrituras destructivas y recortes semánticos. Ningún caso negado debe generar envío; ninguna frase puede truncarse al guardar.
2. Contrato único de acciones/personas/empresas + salidas estructuradas + prompt coherente. Migración coordinada pero pequeña; mismos modelos inicialmente. Mantener reuniones secundarias y cero acciones; todas las acciones conservan su destinatario y organización.
3. Aclaración por campo y acción, compartida entre voz/texto/corrección. Ausencia de fecha no crea fecha; resolver una duda no altera acciones ajenas.
4. Copy CRM, correcciones y exportación con el mismo dato confirmado. Probar «Juan, perdón, José», «no martes, jueves», cambios días después y cancelar Google sin marcar guardado.
5. Comparación de transcripción/modelos, una variable cada vez. Elegir calidad primero y luego menor costo/latencia entre candidatos que cumplan; no prometer sustituto sin medir.
6. Grabación móvil, recuperación, suscripciones y observabilidad; control de seguridad y despliegue de cada bloque.

Cada bloque: caso que falla → arreglo → pruebas locales → revisión de regresiones → despliegue pequeño → comprobación. No publicar todos los cambios de golpe.

## Evaluación propuesta (no ejecutada)

Corpus inicial de 40 notas, 20 por idioma, con mezcla bilingüe, varios contactos/empresas, productos largos, muletillas, negaciones, correcciones, tareas completadas, acciones del cliente, fechas ambiguas y visitas sin seguimiento. Añadir 12 grabaciones reales consentidas para probar ruido/pronunciación; no inferir calidad de audio a partir de texto limpio.

Medir por separado: precisión y cobertura de acciones; vínculo persona/empresa; fidelidad de fechas; hechos añadidos al CRM; preguntas necesarias/omitidas/innecesarias; conservación de correcciones; fallos y reintentos; p50/p95 por etapa; costo por nota completada incluyendo fallos. Reportar conteos y denominadores, no porcentajes sin tamaño de muestra.

Puerta inicial: cero hechos inventados, acciones negadas convertidas o vínculos cruzados en la suite crítica; todas las acciones explícitas del conjunto crítico conservadas. Es un requisito de regresión, no garantía de 100% en usuarios reales. Ampliar con casos reservados antes de elegir modelo.

Primero todas las pruebas locales sin consumo. Antes de pruebas de pago: propuesta concreta de modelos, número de ejecuciones, duración de audios, tokens y presupuesto máximo; aprobación previa. No se ha ejecutado ni aprobado aquí un benchmark de pago.

## Qué conservar

Flujo grabar→resultado, copiar al CRM, acciones separadas, ventanas existentes y exportación manual. Conservar auth, notas privadas y reserva atómica de consumo del bloque anterior, ampliando su evaluación. No introducir agentes múltiples, búsqueda web de contactos, base vectorial ni fine-tuning sin evidencia de beneficio. No reescribir toda la interfaz.

## Documentación oficial contrastada

- [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs): asegura ajuste al esquema; la documentación advierte que aún puede contener errores semánticos.
- [Evaluation best practices](https://developers.openai.com/api/docs/guides/evaluation-best-practices): usar casos típicos, difíciles y adversarios con criterios específicos y evaluación continua.
- [File transcription](https://developers.openai.com/api/docs/guides/speech-to-text): referencia de capacidades de transcripción y contexto; no demuestra por sí sola qué modelo funciona mejor con el audio de Folup.

Esfuerzos indicados son estimaciones de ingeniería, no compromisos de calendario; algunas tareas se solapan. No se propone aún un precio por nota nuevo ni un modelo ganador.
