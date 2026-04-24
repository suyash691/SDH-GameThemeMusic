import { PanelSection } from '@decky/ui'
import useTranslations from '../../hooks/useTranslations'
import PanelSocialButton from '../settings/socialButton'
import { SiDiscord, SiGithub } from 'react-icons/si'

export default function AboutPage() {
  const t = useTranslations()
  return (
    <div>
      <h1>{t('aboutLabel')}</h1>
      <p>{t('aboutDescription')}</p>
      <h2>{t('extras')}</h2>
      <PanelSection>
        <PanelSocialButton
          icon={<SiDiscord fill="#5865F2" />}
          url="https://deckbrew.xyz/discord"
        >
          Discord
        </PanelSocialButton>
        <PanelSocialButton
          icon={<SiGithub fill="#f5f5f5" />}
          url="https://github.com/suyash691/SDH-GameThemeMusic/"
        >
          Github
        </PanelSocialButton>
      </PanelSection>
    </div>
  )
}
