// Loads the HTML-to-lesson-doc converter on demand. It brings the whole TipTap editor library,
// and the pages that use it (course and experience creation, the course editor) only need it
// after an AI generation returns lesson HTML, so they should not ship it up front.
export const loadLessonHtmlToDoc = () => import('./extensions').then(m => m.lessonHtmlToDoc);
