// `?ui=form` switches to the form input (InputPanel). Tests are written against InputPanel, so the test build uses it.
export const BLOCKS_UI =
  import.meta.env.MODE !== 'test' && (typeof window === 'undefined' || new URLSearchParams(window.location.search).get('ui') !== 'form')
