import { ImSpinner2 } from 'react-icons/im'
import { useEffect } from 'react'

const STYLE_ID = 'gtm-spinner-style'
const STYLE_CSS = `
.gtm-icon-spin {
  animation: gtm-icon-spin 2s infinite linear;
}
@keyframes gtm-icon-spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(359deg); }
}
`

export default function Spinner() {
  useEffect(() => {
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement('style')
      style.id = STYLE_ID
      style.textContent = STYLE_CSS
      document.head.appendChild(style)
    }
  }, [])

  return <ImSpinner2 className="gtm-icon-spin" />
}
