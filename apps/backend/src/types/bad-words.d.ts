/**
 * Minimal ambient declaration for `bad-words@3.0.4`.
 *
 * The package ships its own JS but no `.d.ts`, and DefinitelyTyped's
 * `@types/bad-words` only covers v1's API (`isProfane(str)` / `clean(str)`
 * exist on both, but the constructor signature and option names changed).
 * We use only the constructor + `clean()` + `isProfane()` here.
 */
declare module 'bad-words' {
  interface FilterOptions {
    emptyList?: boolean;
    list?: string[];
    exclude?: string[];
    placeHolder?: string;
    regex?: RegExp;
    replaceRegex?: RegExp;
    splitRegex?: RegExp;
  }

  class Filter {
    constructor(options?: FilterOptions);
    isProfane(input: string): boolean;
    clean(input: string): string;
    addWords(...words: string[]): void;
    removeWords(...words: string[]): void;
  }

  export = Filter;
}
