// Development page, loaded by index.html in this folder and left out of the production build.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../../styles/index.css'
import { IconSheet } from './IconSheet.tsx'

const container = document.getElementById('root')
if (container === null) throw new Error('#root is missing in src/ui/icons/sheet/index.html')

createRoot(container).render(
  <StrictMode>
    <IconSheet />
  </StrictMode>,
)
