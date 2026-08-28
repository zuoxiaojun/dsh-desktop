import Image from 'next/image'

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="h-9 w-9 shrink-0 overflow-hidden rounded-lg border border-white/10 bg-black">
        <Image
          src="/brand/ff-logo.png"
          alt="FF Logo"
          width={36}
          height={36}
          priority
          className="h-full w-full object-contain"
        />
      </div>
      {!compact && (
        <div className="whitespace-nowrap text-[13px] font-semibold tracking-tight text-white lg:text-[15px]">
          FF - LLM Wiki 企业知识库
        </div>
      )}
    </div>
  )
}
