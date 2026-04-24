export const definePlugin = (fn: () => unknown) => fn
export const staticClasses = { Title: 'title-class' }
export const useParams = () => ({ appid: '12345' })
export const Tabs = () => null
export const TextField = () => null
export const DialogButton = () => null
export const Focusable = () => null
export const PanelSection = () => null
export const PanelSectionRow = () => null
export const SliderField = () => null
export const ToggleField = () => null
export const DropdownItem = () => null
export const ButtonItem = () => null
export const MenuItem = () => null
export const Navigation = { Navigate: () => {}, CloseSideMenus: () => {} }
export const SteamSpinner = () => null
export const ConfirmModal = () => null
export const ModalRoot = () => null
export const Menu = () => null
export const Field = () => null
export const showModal = () => {}
export const showContextMenu = () => {}
export const afterPatch = () => {}
export const fakeRenderComponent = () => ({ type: null })
export const findInReactTree = () => null
export const findModuleChild = () => null
export const appDetailsClasses = { InnerContainer: 'inner-container' }
export const createReactTreePatcher = () => {}
export const ReactRouter = {}
export const ProgressBarWithInfo = () => null
export type ShowModalResult = {
  Close: () => void
  Update: (c: unknown) => void
}
export type SingleDropdownOption = { data: string; label: string }
export type Patch = { unpatch: () => void }
