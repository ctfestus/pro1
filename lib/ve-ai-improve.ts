/**
 * AI Improve returns the full visible VE structure, but its schema may omit optional or future
 * fields. Merge matching objects by ID so an unrelated rewrite cannot erase stored metadata.
 * Explicit values from the AI, including an empty attachments array, still win.
 */
export function mergeImprovedVeModules(currentModules: any[], improvedModules: any[]): any[] {
  const currentModuleById = new Map((currentModules ?? []).map(module => [module?.id, module]));

  return (improvedModules ?? []).map(improvedModule => {
    const currentModule = currentModuleById.get(improvedModule?.id) ?? {};
    const currentLessonById = new Map((currentModule?.lessons ?? []).map((lesson: any) => [lesson?.id, lesson]));
    const improvedLessons = (improvedModule?.lessons ?? []).map((improvedLesson: any) => {
      const currentLesson: any = currentLessonById.get(improvedLesson?.id) ?? {};
      const currentRequirementById = new Map(
        (currentLesson?.requirements ?? []).map((requirement: any) => [requirement?.id, requirement]),
      );
      const improvedRequirements = (improvedLesson?.requirements ?? []).map((improvedRequirement: any) => ({
        ...(currentRequirementById.get(improvedRequirement?.id) ?? {}),
        ...improvedRequirement,
      }));

      return {
        ...currentLesson,
        ...improvedLesson,
        requirements: improvedRequirements,
      };
    });

    return {
      ...currentModule,
      ...improvedModule,
      lessons: improvedLessons,
    };
  });
}
